import { query, withTransaction } from "../../lib/postgres/client.js";
import { currentTenantId } from "../../lib/postgres/audit-actor.js";
import { MAIN_TENANT_ID } from "../../lib/postgres/ensure-tenancy-schema.js";
import { createNotification } from "../notifications/service.js";

/**
 * Owner<->member messaging (PLAN-notifications-and-owner-messaging.md Part A).
 *
 * A thread is one conversation between the Owner who opened it and one member.
 * The Owner starts it; the member may reply but may not start one. Threads and
 * messages live in their own tables rather than in agent_notifications, which
 * is one alert with one read flag per row - the wrong shape for a conversation.
 *
 * Every message writes notifications as the *signal* it happened: a web
 * notification always, and an agent_notifications row when the recipient is
 * the member, so it reaches their tracker (and, via the tracker, a Windows
 * notification).
 */

export const MAX_SUBJECT = 160;
export const MAX_BODY = 2000;
export const MAX_RECIPIENTS = 200;

export class MessageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const tenant = () => currentTenantId() ?? MAIN_TENANT_ID;

function text(value, max, label) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new MessageError(400, `${label} is required.`);
  if (trimmed.length > max) throw new MessageError(400, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}

/**
 * Members the sender may actually message: active, and in the SENDER'S OWN
 * tenant. The tenant predicate is the reason this is a query rather than a
 * loop over the ids the caller sent - without it an Owner could message
 * another organization's members simply by knowing their ids.
 */
async function resolveRecipients(memberIds) {
  const unique = [...new Set((memberIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!unique.length) throw new MessageError(400, "Pick at least one person to message.");
  if (unique.length > MAX_RECIPIENTS) {
    throw new MessageError(400, `You can message at most ${MAX_RECIPIENTS} people at once.`);
  }
  const rows = await query(
    `SELECT id FROM members
      WHERE id = ANY($1::uuid[]) AND status = 'active' AND tenant_id = $2`,
    [unique, tenant()],
  );
  const allowed = rows.map((r) => String(r.id));
  return { allowed, skipped: unique.filter((id) => !allowed.includes(id)) };
}

/** The other participant, from the point of view of whoever just posted. */
function counterpartOf(thread, senderId) {
  const member = String(thread.member_id);
  return senderId === member ? (thread.opened_by ? String(thread.opened_by) : null) : member;
}

async function signal(client, { recipientId, threadId, subject, body, toMember }) {
  if (!recipientId) return;
  // Web notification: always, so a message is readable even with the tracker
  // closed. Links to the thread so Part B can open it directly.
  await createNotification(null, {
    recipient_id: recipientId,
    type: toMember ? "owner_message" : "member_reply",
    title: subject,
    message: body.length > 180 ? `${body.slice(0, 177)}...` : body,
    link: `notifications?thread=${threadId}`,
  });
  // Tracker inbox: only the member has one.
  if (toMember) {
    await client.query(
      `INSERT INTO agent_notifications (recipient_id, type, title, message, created_by, tenant_id)
       VALUES ($1, 'owner_message', $2, $3, $4, $5)`,
      [recipientId, subject, body, null, tenant()],
    );
  }
}

/** Opens one thread per recipient and posts the first message. */
export async function openThreads(ownerId, { memberIds, subject, body }) {
  const cleanSubject = text(subject, MAX_SUBJECT, "Subject");
  const cleanBody = text(body, MAX_BODY, "Message");
  const { allowed, skipped } = await resolveRecipients(memberIds);
  if (!allowed.length) {
    throw new MessageError(404, "None of those people are in your organization.");
  }

  const threadIds = await withTransaction(async (client) => {
    const created = [];
    for (const memberId of allowed) {
      const rows = await client.query(
        `INSERT INTO message_threads (member_id, opened_by, subject, tenant_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [memberId, ownerId, cleanSubject, tenant()],
      );
      const threadId = String(rows.rows[0].id);
      await client.query(
        `INSERT INTO thread_messages (thread_id, sender_id, body, tenant_id) VALUES ($1, $2, $3, $4)`,
        [threadId, ownerId, cleanBody, tenant()],
      );
      await signal(client, {
        recipientId: memberId,
        threadId,
        subject: cleanSubject,
        body: cleanBody,
        toMember: true,
      });
      created.push(threadId);
    }
    return created;
  });

  return { sent: threadIds.length, skipped: skipped.length, threadIds };
}

async function loadThreadForParticipant(threadId, viewerId) {
  const rows = await query(
    `SELECT id, member_id, opened_by, subject, closed_at
       FROM message_threads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [threadId, tenant()],
  );
  const thread = rows[0];
  if (!thread) throw new MessageError(404, "Conversation not found.");
  const isParticipant =
    String(thread.member_id) === viewerId || (thread.opened_by && String(thread.opened_by) === viewerId);
  // 404 rather than 403: a non-participant should not learn the thread exists.
  if (!isParticipant) throw new MessageError(404, "Conversation not found.");
  return thread;
}

/** Appends a message. Either participant may - this is the two-way half. */
export async function replyToThread(threadId, viewerId, body) {
  const cleanBody = text(body, MAX_BODY, "Message");
  const thread = await loadThreadForParticipant(threadId, viewerId);
  if (thread.closed_at) throw new MessageError(409, "This conversation is closed.");

  const recipientId = counterpartOf(thread, viewerId);
  const toMember = recipientId === String(thread.member_id);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO thread_messages (thread_id, sender_id, body, tenant_id) VALUES ($1, $2, $3, $4)`,
      [threadId, viewerId, cleanBody, tenant()],
    );
    await client.query(`UPDATE message_threads SET last_message_at = now() WHERE id = $1`, [threadId]);
    await signal(client, {
      recipientId,
      threadId,
      subject: thread.subject,
      body: cleanBody,
      toMember,
    });
  });

  return { ok: true };
}

/** Threads the viewer is in: their own as a member, plus any they opened. */
export async function listThreads(viewerId, { limit = 50 } = {}) {
  const rows = await query(
    `SELECT t.id, t.subject, t.member_id, t.opened_by, t.created_at, t.last_message_at, t.closed_at,
            m.first_name, m.last_name, m.work_email,
            (SELECT count(*) FROM thread_messages tm
              WHERE tm.thread_id = t.id AND tm.read_at IS NULL AND tm.sender_id <> $1) AS unread,
            (SELECT tm.body FROM thread_messages tm
              WHERE tm.thread_id = t.id ORDER BY tm.created_at DESC LIMIT 1) AS last_body
       FROM message_threads t
       JOIN members m ON m.id = t.member_id
      WHERE t.tenant_id = $2 AND (t.member_id = $1 OR t.opened_by = $1)
      ORDER BY t.last_message_at DESC
      LIMIT $3`,
    [viewerId, tenant(), Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    subject: r.subject,
    memberId: String(r.member_id),
    memberName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.work_email || "Member",
    openedByMe: r.opened_by && String(r.opened_by) === viewerId,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
    closed: Boolean(r.closed_at),
    unread: Number(r.unread ?? 0),
    lastBody: r.last_body ?? "",
  }));
}

export async function getThread(threadId, viewerId) {
  const thread = await loadThreadForParticipant(threadId, viewerId);
  const rows = await query(
    `SELECT id, sender_id, body, created_at, read_at
       FROM thread_messages WHERE thread_id = $1 ORDER BY created_at`,
    [threadId],
  );
  return {
    id: String(thread.id),
    subject: thread.subject,
    memberId: String(thread.member_id),
    closed: Boolean(thread.closed_at),
    messages: rows.map((r) => ({
      id: String(r.id),
      body: r.body,
      createdAt: r.created_at,
      mine: r.sender_id && String(r.sender_id) === viewerId,
      read: Boolean(r.read_at),
    })),
  };
}

/** Marks the OTHER side's messages read - never your own. */
export async function markThreadRead(threadId, viewerId) {
  await loadThreadForParticipant(threadId, viewerId);
  await query(
    `UPDATE thread_messages SET read_at = now()
      WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
    [threadId, viewerId],
  );
  return { ok: true };
}
