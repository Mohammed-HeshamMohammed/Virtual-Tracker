import { isInviteConsumed, isInviteExpired } from "./invite-lifecycle.js";
import { findActiveBanByEmail } from "./member-ban-service.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeMemberEmail(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

const REASON = {
  INVALID: "invalid_email",
  AUTH_EXISTS: "auth_exists",
  MEMBER_RECORD: "member_exists",
  PENDING_PREPROVISION: "pending_preprovision",
  PENDING_INVITE: "pending_invite",
  BANNED: "account_banned",
};

/**
 * @param {import("firebase-admin/auth").Auth} auth
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} emailNorm
 * @param {{ forOpenInviteLink?: boolean, ignoreInviteId?: string }} [opts] Use `ignoreInviteId` when completing that invite (doc still `pending_signup` until the user registers).
 * @returns {Promise<{ ok: boolean, reason: string, message: string }>}
 */
export async function assertEmailCanUseMemberInviteOrPreprovision(db, auth, emailNorm, opts = {}) {
  const e = normalizeMemberEmail(emailNorm);
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, reason: REASON.INVALID, message: "That email address is not valid." };
  }

  const activeBan = await findActiveBanByEmail(db, e);
  if (activeBan) {
    return {
      ok: false,
      reason: REASON.BANNED,
      message: "This email address has been restricted from Virtual Tracker. Contact support if you believe this was a mistake.",
    };
  }

  if (opts.forOpenInviteLink) {
    return { ok: true, reason: "", message: "" };
  }
  const { ignoreInviteId } = opts;

  try {
    await auth.getUserByEmail(e);
    return {
      ok: false,
      reason: REASON.AUTH_EXISTS,
      message: "This email is already used for a Virtual Tracker sign-in. They should sign in instead of receiving a new invite.",
    };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(/** @type {{ code?: string }} */ (err).code) : "";
    if (code === "auth/user-not-found") {
      /* continue to Firestore checks */
    } else {
      if (code.startsWith("auth/")) {
        return {
          ok: false,
          reason: REASON.AUTH_EXISTS,
          message: "Could not verify this email. Try again or use another address.",
        };
      }
      throw err;
    }
  }

  const memberRows = await pgQuery("SELECT id FROM members WHERE work_email = $1 LIMIT 1", [e]);
  if (memberRows.length) {
    return {
      ok: false,
      reason: REASON.MEMBER_RECORD,
      message: "This person is already listed as a member (same work email).",
    };
  }

  const pendingAuthRows = await pgQuery("SELECT firebase_uid FROM pending_auth_members WHERE email = $1 LIMIT 1", [e]);
  if (pendingAuthRows.length) {
    return {
      ok: false,
      reason: REASON.PENDING_PREPROVISION,
      message: "This email already has a pending account. Finish setup or use another address.",
    };
  }

  const inviteRows = await pgQuery("SELECT * FROM invites WHERE email = $1", [e]);
  const pendingInvite = inviteRows.find((s) => {
    if (typeof ignoreInviteId === "string" && ignoreInviteId && s.id === ignoreInviteId) return false;
    if (typeof s.status !== "string" || s.status !== "pending_signup") return false;
    if (isInviteExpired(s) || isInviteConsumed(s)) return false;
    return true;
  });
  if (pendingInvite) {
    return {
      ok: false,
      reason: REASON.PENDING_INVITE,
      message: "This email already has a pending invite that has not been completed yet.",
    };
  }

  return { ok: true, reason: "", message: "" };
}

/**
 * @param {import("firebase-admin/auth").Auth} auth
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} rawEmails
 * @param {{ forOpenInviteLink?: boolean }} [opts]
 * @returns {Promise<{ allOk: boolean, results: { email: string, ok: boolean, reason: string, message: string }[] }>}
 */
export async function validateEmailsForAddMembersFlow(db, auth, rawEmails, opts = {}) {
  const unique = new Map();
  for (const r of Array.isArray(rawEmails) ? rawEmails : []) {
    const n = normalizeMemberEmail(r);
    if (n) unique.set(n, n);
  }
  const results = [];
  let allOk = true;
  for (const email of unique.keys()) {
    const res = await assertEmailCanUseMemberInviteOrPreprovision(db, auth, email, opts);
    const ok = res.ok;
    if (!ok) allOk = false;
    results.push({ email, ok, reason: res.reason || "", message: res.message || "" });
  }
  return { allOk, results };
}

export { REASON };
