import { sendMemberInviteEmail } from "../../auth/invite-email.js";
import { resolveAppPublicUrl } from "../../auth/app-public-url.js";
import { isInviteConsumed, isInviteExpired } from "./invite-lifecycle.js";
import { resolveRoleNameById } from "./relation-sync.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";

/**
 * @param {string} inviteId
 */
async function loadInviteForManagement(inviteId) {
  if (!inviteId || typeof inviteId !== "string") {
    return { ok: false, httpStatus: 400, error: "Invalid invite id." };
  }
  if (inviteId.startsWith("pa_")) {
    return { ok: false, httpStatus: 400, error: "Pre-provisioned accounts use different actions." };
  }
  const rows = await pgQuery("SELECT * FROM invites WHERE id = $1 LIMIT 1", [inviteId]);
  if (!rows.length) {
    return { ok: false, httpStatus: 404, error: "Invite not found." };
  }
  return { ok: true, row: rows[0] };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string | undefined} appOrigin
 */
function buildInviteUrl(row, appOrigin) {
  const token = typeof row.invite_token === "string" ? row.invite_token.trim() : "";
  if (!token) return null;
  return `${resolveAppPublicUrl(appOrigin)}/invite/${token}`;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 * @param {string | undefined} appOrigin
 */
export async function getInviteManagementLink(db, inviteId, appOrigin) {
  const loaded = await loadInviteForManagement(inviteId);
  if (!loaded.ok) return loaded;

  const inviteKind = typeof loaded.row.invite_kind === "string" ? loaded.row.invite_kind : "email";
  if (inviteKind !== "email") {
    return { ok: false, httpStatus: 400, error: "Only email invites have a management link." };
  }
  if (isInviteConsumed(loaded.row)) {
    return { ok: false, httpStatus: 410, error: "This invite has already been used." };
  }

  const inviteUrl = buildInviteUrl(loaded.row, appOrigin);
  if (!inviteUrl) {
    return { ok: false, httpStatus: 500, error: "Invite link is unavailable." };
  }
  return { ok: true, inviteUrl };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 */
export async function renewInviteForManagement(db, inviteId) {
  const loaded = await loadInviteForManagement(inviteId);
  if (!loaded.ok) return loaded;

  if (isInviteConsumed(loaded.row)) {
    return { ok: false, httpStatus: 410, error: "This invite has already been used." };
  }

  const rows = await pgQuery(
    `UPDATE invites SET status = $1, expires_at = $2, sent_at = $3, updated_at = now()
     WHERE id = $4
     RETURNING *`,
    ["pending_signup", null, new Date(), inviteId],
  );

  return { ok: true, row: rows[0] };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 * @param {{ appOrigin?: string }} [opts]
 */
export async function resendInviteEmailForManagement(db, inviteId, opts = {}) {
  const loaded = await loadInviteForManagement(inviteId);
  if (!loaded.ok) return loaded;

  const inviteKind = typeof loaded.row.invite_kind === "string" ? loaded.row.invite_kind : "email";
  if (inviteKind !== "email") {
    return { ok: false, httpStatus: 400, error: "Only email invites can be resent." };
  }
  if (isInviteConsumed(loaded.row)) {
    return { ok: false, httpStatus: 410, error: "This invite has already been used." };
  }

  const email = typeof loaded.row.email === "string" ? loaded.row.email.trim().toLowerCase() : "";
  if (!email) {
    return { ok: false, httpStatus: 400, error: "Invite has no email address." };
  }

  const status = typeof loaded.row.status === "string" ? loaded.row.status : "";
  const expiring = isInviteExpired(loaded.row) || status === "expired";

  const rows = await pgQuery(
    `UPDATE invites SET
       sent_at = $1,
       updated_at = now(),
       status = CASE WHEN $2 THEN $3 ELSE status END,
       expires_at = CASE WHEN $2 THEN NULL ELSE expires_at END
     WHERE id = $4
     RETURNING *`,
    [new Date(), expiring, "pending_signup", inviteId],
  );
  const updatedRow = rows[0];

  const inviteUrl = buildInviteUrl(updatedRow, opts.appOrigin);
  if (!inviteUrl) {
    return { ok: false, httpStatus: 500, error: "Invite link is unavailable." };
  }

  const roleName =
    (await resolveRoleNameById(db, typeof updatedRow.role_id === "string" ? updatedRow.role_id : "")) || "Viewer";
  const emailResult = await sendMemberInviteEmail({ email, inviteUrl, roleName });

  return {
    ok: true,
    email,
    emailSent: emailResult.sent,
    channel: emailResult.channel,
    emailError: typeof emailResult.error === "string" ? emailResult.error : undefined,
    inviteUrl,
    row: updatedRow,
  };
}
