import crypto from "node:crypto";
import { createNotification } from "../notifications/service.js";
import { recordMemberRelationship } from "../member-relationships/service.js";
import { getMemberParentId } from "../member-relationships/service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { resolveRoleIdsWhere } from "../members/services/relation-sync.js";
import {
  canCreateTransferRequests,
  isValidTransferTarget,
} from "./hierarchy-placement.js";
import { syncMemberHierarchyStatus } from "./hierarchy-sync.js";
import {
  buildTransferRequestUrl,
  defaultTransferExpiry,
  generateTransferToken,
  sendMemberTransferEmail,
} from "./transfer-email.js";

import { query as pgQuery } from "../../lib/postgres/client.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";

const TABLE = "member_transfer_requests";
const TRANSFER_COLUMNS =
  "id, requester_member_id, target_member_id, target_email, token, status, expires_at, responded_at, completed_at, created_at";
const TRANSFER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

async function findMemberByEmail(db, email) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const rows = await pgQuery(
    "SELECT * FROM members WHERE LOWER(work_email) = $1 OR LOWER(personal_email) = $1 LIMIT 1",
    [normalized],
  );
  if (!rows.length) return null;
  const m = rows[0];
  return { id: m.id, data: m };
}

function isTransferExpired(row) {
  if (row.status === "expired") return true;
  const expiresAt = row.expires_at;
  if (!expiresAt) return false;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : new Date(String(expiresAt)).getTime();
  return Number.isFinite(ms) && ms < Date.now();
}

async function findTransferByToken(_db, token) {
  if (!token || typeof token !== "string" || token.length < 32) return null;
  const rows = await pgQuery(`SELECT ${TRANSFER_COLUMNS} FROM ${TABLE} WHERE token = $1 LIMIT 1`, [token]);
  if (!rows.length) return null;
  const data = rows[0];
  return { id: data.id, data, update: (patch) => updateTransferRow(data.id, patch) };
}

async function updateTransferRow(id, patch) {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  const sets = entries.map(([column], i) => `${column} = $${i + 2}`);
  await pgQuery(
    `UPDATE ${TABLE} SET ${sets.join(", ")} WHERE id = $1`,
    [id, ...entries.map(([, value]) => value)],
  );
}

async function getRequesterDisplayName(db, requesterMemberId) {
  const d = (await getMemberByIdPg(requesterMemberId)) || {};
  const first = typeof d.first_name === "string" ? d.first_name.trim() : "";
  const last = typeof d.last_name === "string" ? d.last_name.trim() : "";
  const name = (typeof d.display_name === "string" && d.display_name.trim()) || [first, last].filter(Boolean).join(" ");
  return name || "A team manager";
}

export async function notifyAdminRoles(db, title, message, link = "") {
  const adminRoles = ["Owner", "Super Admin", "Admin"];
  const roleIds = await resolveRoleIdsWhere((name) => adminRoles.includes(name));

  if (!roleIds.length) return;

  const rows = await pgQuery("SELECT id FROM members WHERE role_id = ANY($1) AND status != 'banned'", [roleIds]);
  const notified = new Set();
  for (const row of rows) {
    if (!row.id || notified.has(row.id)) continue;
    notified.add(row.id);
    try {
      await createNotification(db, {
        recipient_id: row.id,
        type: "hierarchy_alert",
        title,
        message,
        link,
      });
    } catch {
      // Non-fatal
    }
  }
}

export async function createMemberTransferRequest(db, {
  requesterMemberId,
  requesterRoleName,
  targetEmail,
  appOrigin,
}) {
  if (!canCreateTransferRequests(requesterRoleName)) {
    return { ok: false, httpStatus: 403, error: "Only Managers and Super Managers can create transfer requests." };
  }

  const email = typeof targetEmail === "string" ? targetEmail.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return { ok: false, httpStatus: 400, error: "A valid target email is required." };
  }

  const targetMember = await findMemberByEmail(db, email);
  if (!targetMember) {
    return { ok: false, httpStatus: 404, error: "No account exists with this email address." };
  }

  const memberEmail = [
    targetMember.data.work_email,
    targetMember.data.personal_email,
  ]
    .filter((v) => typeof v === "string")
    .map((v) => v.trim().toLowerCase());

  if (!memberEmail.includes(email)) {
    return { ok: false, httpStatus: 400, error: "Email does not match the existing user account." };
  }

  const targetRoleName = await resolveMemberRoleName(db, targetMember.id);
  const targetParentId = await getMemberParentId(db, targetMember.id);

  if (!isValidTransferTarget(targetRoleName, targetParentId, targetMember.data)) {
    return { ok: false, httpStatus: 400, error: "This member cannot be recruited into your hierarchy." };
  }

  if (targetMember.id === requesterMemberId) {
    return { ok: false, httpStatus: 400, error: "You cannot send a transfer request to yourself." };
  }

  const pendingRows = await pgQuery(
    `SELECT ${TRANSFER_COLUMNS} FROM ${TABLE}
      WHERE target_member_id = $1 AND requester_member_id = $2 AND status = 'pending'
      LIMIT 1`,
    [targetMember.id, requesterMemberId],
  );

  if (pendingRows.length) {
    const row = pendingRows[0];
    const transferUrl = buildTransferRequestUrl(row.token, appOrigin);
    return {
      ok: true,
      id: row.id,
      token: row.token,
      transfer_url: transferUrl,
      status: "pending",
      existing: true,
    };
  }

  const id = crypto.randomUUID();
  const token = generateTransferToken();
  const expiresAt = defaultTransferExpiry();
  const now = new Date();

  await pgQuery(
    `INSERT INTO ${TABLE}
       (id, requester_member_id, target_member_id, target_email, token, status, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
    [id, requesterMemberId, targetMember.id, email, token, expiresAt, now],
  );

  const transferUrl = buildTransferRequestUrl(token, appOrigin);
  const requesterName = await getRequesterDisplayName(db, requesterMemberId);

  await sendMemberTransferEmail({ email, transferUrl, requesterName });

  await createNotification(db, {
    recipient_id: requesterMemberId,
    type: "transfer_request_created",
    title: "Transfer request sent",
    message: `Your invitation to ${email} has been sent.`,
    link: "people-members",
  });

  await createNotification(db, {
    recipient_id: targetMember.id,
    type: "transfer_invitation",
    title: "Team membership invitation",
    message: `${requesterName} has invited you to join their team.`,
    link: `/transfer/${token}`,
  });

  return {
    ok: true,
    id,
    token,
    transfer_url: transferUrl,
    status: "pending",
    expires_at: expiresAt.toISOString(),
  };
}

export async function acceptMemberTransferRequest(db, { token, acceptorMemberId, acceptorEmail }) {
  const found = await findTransferByToken(db, token);
  if (!found) {
    return { ok: false, httpStatus: 404, error: "Transfer invitation not found or invalid." };
  }

  const row = found.data;

  if (row.status !== "pending") {
    return { ok: false, httpStatus: 410, error: `This invitation has already been ${row.status}.` };
  }

  if (isTransferExpired(row)) {
    await found.update({ status: "expired", responded_at: new Date() });
    return { ok: false, httpStatus: 410, error: "This invitation has expired." };
  }

  if (row.target_member_id !== acceptorMemberId) {
    return { ok: false, httpStatus: 403, error: "This invitation is not for your account." };
  }

  const normalizedEmail = typeof acceptorEmail === "string" ? acceptorEmail.trim().toLowerCase() : "";
  if (row.target_email !== normalizedEmail) {
    return { ok: false, httpStatus: 403, error: "Email does not match this invitation." };
  }

  const requesterId = row.requester_member_id;
  const existingParent = await getMemberParentId(db, acceptorMemberId);

  if (existingParent && existingParent !== requesterId) {
    await found.update({ status: "declined", responded_at: new Date() });
    await createNotification(db, {
      recipient_id: requesterId,
      type: "transfer_declined",
      title: "Transfer declined",
      message: "The member is already assigned to another hierarchy.",
      link: "people-members",
    });
    return { ok: false, httpStatus: 409, error: "You are already assigned to another hierarchy." };
  }

  try {
    if (!existingParent) {
      await recordMemberRelationship(db, {
        parentMemberId: requesterId,
        childMemberId: acceptorMemberId,
        relationshipType: "transfer",
        createdBy: acceptorMemberId,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to establish hierarchy relationship.";
    return { ok: false, httpStatus: 400, error: msg };
  }

  const roleName = await resolveMemberRoleName(db, acceptorMemberId);
  await syncMemberHierarchyStatus(db, acceptorMemberId, roleName);

  const now = new Date();
  await found.update({
    status: "completed",
    responded_at: now,
    completed_at: now,
    token: null,
  });

  const requesterName = await getRequesterDisplayName(db, requesterId);

  await createNotification(db, {
    recipient_id: requesterId,
    type: "transfer_completed",
    title: "Transfer completed",
    message: `${normalizedEmail} has joined your team.`,
    link: "people-members-tree",
  });

  await createNotification(db, {
    recipient_id: acceptorMemberId,
    type: "transfer_completed",
    title: "Welcome to the team",
    message: `You are now part of ${requesterName}'s team.`,
    link: "people-members-tree",
  });

  return { ok: true, requester_member_id: requesterId, target_member_id: acceptorMemberId };
}

export async function declineMemberTransferRequest(db, { token, declinerMemberId }) {
  const found = await findTransferByToken(db, token);
  if (!found) {
    return { ok: false, httpStatus: 404, error: "Transfer invitation not found." };
  }

  const row = found.data;
  if (row.status !== "pending") {
    return { ok: false, httpStatus: 410, error: `This invitation has already been ${row.status}.` };
  }

  if (row.target_member_id !== declinerMemberId) {
    return { ok: false, httpStatus: 403, error: "This invitation is not for your account." };
  }

  await found.update({ status: "declined", responded_at: new Date(), token: null });

  await createNotification(db, {
    recipient_id: row.requester_member_id,
    type: "transfer_declined",
    title: "Transfer declined",
    message: "Your team invitation was declined.",
    link: "people-members",
  });

  return { ok: true };
}

export async function getTransferRequestPreview(db, token) {
  const found = await findTransferByToken(db, token);
  if (!found) {
    return { ok: false, httpStatus: 404, error: "Transfer invitation not found." };
  }

  const row = found.data;
  if (row.status !== "pending") {
    return { ok: false, httpStatus: 410, error: `This invitation is ${row.status}.` };
  }
  if (isTransferExpired(row)) {
    return { ok: false, httpStatus: 410, error: "This invitation has expired." };
  }

  const requesterName = await getRequesterDisplayName(db, row.requester_member_id);
  return {
    ok: true,
    requester_name: requesterName,
    target_email_masked: maskEmail(row.target_email),
    expires_at: row.expires_at,
    status: row.status,
  };
}

function maskEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  const masked = local.length <= 2 ? "**" : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

export { TABLE as TRANSFER_REQUESTS_TABLE, TRANSFER_EXPIRY_MS };
