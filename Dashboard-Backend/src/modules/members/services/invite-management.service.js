import { sendMemberInviteEmail } from "../../auth/invite-email.js";
import { resolveAppPublicUrl } from "../../auth/app-public-url.js";
import { isInviteConsumed, isInviteExpired } from "./invite-lifecycle.js";
import { resolveRoleNameById } from "./relation-sync.js";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 */
async function loadInviteForManagement(db, inviteId) {
  if (!inviteId || typeof inviteId !== "string") {
    return { ok: false, httpStatus: 400, error: "Invalid invite id." };
  }
  if (inviteId.startsWith("pa_")) {
    return { ok: false, httpStatus: 400, error: "Pre-provisioned accounts use different actions." };
  }
  const ref = db.collection("invites").doc(inviteId);
  const doc = await ref.get();
  if (!doc.exists) {
    return { ok: false, httpStatus: 404, error: "Invite not found." };
  }
  return { ok: true, ref, row: doc.data() || {} };
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
  const loaded = await loadInviteForManagement(db, inviteId);
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
  const loaded = await loadInviteForManagement(db, inviteId);
  if (!loaded.ok) return loaded;

  if (isInviteConsumed(loaded.row)) {
    return { ok: false, httpStatus: 410, error: "This invite has already been used." };
  }

  await loaded.ref.update({
    status: "pending_signup",
    expires_at: null,
    sent_at: new Date(),
    updated_at: new Date(),
  });

  const next = await loaded.ref.get();
  return { ok: true, row: { id: next.id, ...next.data() } };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 * @param {{ appOrigin?: string }} [opts]
 */
export async function resendInviteEmailForManagement(db, inviteId, opts = {}) {
  const loaded = await loadInviteForManagement(db, inviteId);
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

  /** @type {Record<string, unknown>} */
  const updates = { sent_at: new Date(), updated_at: new Date() };
  const status = typeof loaded.row.status === "string" ? loaded.row.status : "";
  if (isInviteExpired(loaded.row) || status === "expired") {
    updates.status = "pending_signup";
    updates.expires_at = null;
  }
  await loaded.ref.update(updates);

  const inviteUrl = buildInviteUrl(loaded.row, opts.appOrigin);
  if (!inviteUrl) {
    return { ok: false, httpStatus: 500, error: "Invite link is unavailable." };
  }

  const roleName =
    (await resolveRoleNameById(db, typeof loaded.row.role_id === "string" ? loaded.row.role_id : "")) || "Viewer";
  const emailResult = await sendMemberInviteEmail({ email, inviteUrl, roleName });

  const next = await loaded.ref.get();
  return {
    ok: true,
    email,
    emailSent: emailResult.sent,
    channel: emailResult.channel,
    emailError: typeof emailResult.error === "string" ? emailResult.error : undefined,
    inviteUrl,
    row: { id: next.id, ...next.data() },
  };
}
