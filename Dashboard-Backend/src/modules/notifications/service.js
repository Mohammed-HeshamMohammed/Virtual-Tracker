import { query } from "../../lib/postgres/client.js";
import { publishChange } from "../realtime/change-bus.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most ids one bulk read/clear accepts. The bell loads 30 at a time. */
export const MAX_NOTIFICATION_IDS = 200;

function normalizeRow(row) {
  const createdAt = row.created_at;
  return {
    id: row.id,
    recipient_id: row.recipient_id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link || "",
    read: Boolean(row.read),
    created_at: createdAt instanceof Date ? createdAt.getTime() : createdAt,
  };
}

/** Ids are UUIDs. Anything else would reach Postgres as a cast error - a 500
 *  for what is really "no such notification". */
export function isNotificationId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/** `{ ids }` of the valid, de-duplicated ids, or `{ error }` when there are none. */
export function parseNotificationIds(value) {
  if (!Array.isArray(value)) return { error: "ids must be an array of notification ids." };
  if (value.length > MAX_NOTIFICATION_IDS) {
    return { error: `At most ${MAX_NOTIFICATION_IDS} notification ids per request.` };
  }
  const ids = [...new Set(value.filter(isNotificationId).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return { error: "No valid notification ids given." };
  return { ids };
}

export async function createNotification(_db, payload) {
  if (!payload.recipient_id || !payload.title || !payload.message) {
    throw new Error("Missing required notification fields");
  }

  const rows = await query(
    `INSERT INTO notifications (recipient_id, type, title, message, link)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [payload.recipient_id, payload.type || "system", payload.title, payload.message, payload.link || ""],
  );
  void publishChange("notifications", rows[0].id, "created");
  return rows[0].id;
}

export async function listNotificationsForMember(_db, memberId, limit = 30) {
  const rows = await query(
    `SELECT id, recipient_id, type, title, message, link, read, created_at
     FROM notifications
     WHERE recipient_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [memberId, limit],
  );
  return rows.map(normalizeRow);
}

/** Every unread notification, not just the page the list returned - a burst
 *  of alerts can leave far more than 30 unread. */
export async function countUnreadNotifications(_db, memberId) {
  const rows = await query(
    `SELECT count(*)::int AS unread FROM notifications WHERE recipient_id = $1 AND read = false`,
    [memberId],
  );
  return Number(rows[0]?.unread ?? 0);
}

export async function markNotificationAsRead(_db, notificationId, memberId) {
  const rows = await query(
    `UPDATE notifications SET read = true WHERE id = $1 AND recipient_id = $2 RETURNING id`,
    [notificationId, memberId],
  );
  return rows.length > 0;
}

/** Marks the given notifications read. Returns how many changed. */
export async function markNotificationsAsRead(_db, memberId, ids) {
  const rows = await query(
    `UPDATE notifications SET read = true
     WHERE recipient_id = $1 AND id = ANY($2::uuid[]) AND read = false
     RETURNING id`,
    [memberId, ids],
  );
  return rows.length;
}

export async function markAllNotificationsAsRead(_db, memberId) {
  await query(`UPDATE notifications SET read = true WHERE recipient_id = $1 AND read = false`, [memberId]);
}

export async function deleteNotification(_db, notificationId, memberId) {
  const rows = await query(`DELETE FROM notifications WHERE id = $1 AND recipient_id = $2 RETURNING id`, [
    notificationId,
    memberId,
  ]);
  return rows.length > 0;
}

/**
 * Clears the given ids, or every read notification (`readOnly`), or - with
 * neither - all of them. Always limited to the member's own. Returns how many
 * were removed. The route only reaches the clear-everything case on an
 * explicit `all: true`.
 */
export async function clearNotifications(_db, memberId, { ids, readOnly } = {}) {
  if (ids) {
    const rows = await query(
      `DELETE FROM notifications WHERE recipient_id = $1 AND id = ANY($2::uuid[]) RETURNING id`,
      [memberId, ids],
    );
    return rows.length;
  }
  if (readOnly) {
    const rows = await query(`DELETE FROM notifications WHERE recipient_id = $1 AND read = true RETURNING id`, [
      memberId,
    ]);
    return rows.length;
  }
  const rows = await query(`DELETE FROM notifications WHERE recipient_id = $1 RETURNING id`, [memberId]);
  return rows.length;
}
