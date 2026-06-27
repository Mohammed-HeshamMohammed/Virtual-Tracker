import { getEnv } from "../../../config/env/index.js";

/** Default TTL for shareable open invite links (hours). Override with INVITE_SHARE_LINK_TTL_HOURS in Backend/.env. */
export const SHARE_LINK_DEFAULT_TTL_HOURS = 168;

/**
 * @returns {number}
 */
export function resolveShareLinkTtlHours() {
  return getEnv().invites.shareLinkTtlHours;
}

/**
 * @param {number} [ttlHours]
 * @returns {Date}
 */
export function computeShareLinkExpiresAt(ttlHours = resolveShareLinkTtlHours()) {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} row
 * @returns {number | null}
 */
export function resolveInviteExpiryMs(row) {
  if (!row || typeof row !== "object") return null;
  const exp = row.expires_at ?? row.expiresAt;
  if (exp instanceof Date) return exp.getTime();
  if (exp && typeof exp === "object" && typeof exp.toDate === "function") return exp.toDate().getTime();
  if (typeof exp === "string") {
    const n = Date.parse(exp);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} row
 * @param {number} [nowMs]
 */
export function isInviteExpired(row, nowMs = Date.now()) {
  const ms = resolveInviteExpiryMs(row);
  if (ms == null) return false;
  return nowMs >= ms;
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown> | null | undefined} row
 */
export function isInviteConsumed(row) {
  if (!row || typeof row !== "object") return true;
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "completed" || status === "accepted") return true;
  const maxUses = typeof row.max_uses === "number" ? row.max_uses : typeof row.maxUses === "number" ? row.maxUses : null;
  const useCount =
    typeof row.use_count === "number" ? row.use_count : typeof row.useCount === "number" ? row.useCount : 0;
  if (maxUses != null && useCount >= maxUses) return true;
  return false;
}

/**
 * Invites that should not appear in the management Invites tab (joined members, share links).
 *
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown>} row
 */
export function shouldHideInviteFromActiveList(row) {
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "completed" || status === "accepted") return true;
  const inviteKind =
    typeof row.invite_kind === "string"
      ? row.invite_kind
      : typeof row.inviteKind === "string"
        ? row.inviteKind
        : "email";
  return inviteKind === "open_link";
}

/**
 * @param {FirebaseFirestore.DocumentData | Record<string, unknown>} row
 * @returns {{ ok: true } | { ok: false; error: string; httpStatus: number }}
 */
export function assertInviteAvailableForRegistration(row) {
  const status = typeof row.status === "string" ? row.status : "";
  if (status !== "pending_signup") {
    return { ok: false, error: "This invite is no longer valid.", httpStatus: 410 };
  }
  if (isInviteExpired(row)) {
    return { ok: false, error: "This invite link has expired.", httpStatus: 410 };
  }
  if (isInviteConsumed(row)) {
    return { ok: false, error: "This invite link has already been used.", httpStatus: 410 };
  }
  return { ok: true };
}

/**
 * Constraints applied to shareable open invite links.
 *
 * @param {number} [ttlHours]
 */
export function shareLinkInviteFields(ttlHours = resolveShareLinkTtlHours()) {
  return {
    max_uses: 1,
    use_count: 0,
    expires_at: computeShareLinkExpiresAt(ttlHours),
  };
}
