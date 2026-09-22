import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The token a verified Owner/Super Admin holds after unlock/verify, bound to
 * every mutating Customer Accounts endpoint (PLAN-customer-accounts-and-
 * tenancy.md §16.3: "not meant to be UI but full system"). Deliberately an
 * in-memory bearer capability, not a JWT or a DB row:
 *   - It needs no signing secret to manage - possession of the raw value
 *     (never persisted, only ever held by the client that received it) IS
 *     the credential, the same shape as an agent device secret.
 *   - It needs no DB round-trip on every mutating call.
 * Same process-local tolerance already accepted by role-cache.js and
 * lookup-cache.js: on a multi-replica deployment a token minted on one
 * instance will not verify on another, which just means an extra
 * unlock/verify - never a security gap, since the token can only ever be
 * *rejected* too eagerly, not accepted wrongly.
 */
const TOKEN_TTL_MINUTES = 20;
const tokens = new Map();

function hash(raw) {
  return createHash("sha256").update(String(raw)).digest("hex");
}

function sweepExpired() {
  const now = Date.now();
  for (const [key, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(key);
  }
}

/** Mints a fresh token for a member, invalidating any token they already
 *  held for this purpose - a member can only ever have one active unlock at
 *  a time, which is also what makes "closing the tab locks it again" true
 *  even if closing the tab merely drops the client's copy without an
 *  explicit revoke call. */
export function issueUnlockToken(memberId) {
  sweepExpired();
  for (const [key, entry] of tokens) {
    if (entry.memberId === memberId) tokens.delete(key);
  }
  const raw = randomBytes(32).toString("hex");
  tokens.set(hash(raw), { memberId, expiresAt: Date.now() + TOKEN_TTL_MINUTES * 60 * 1000 });
  return raw;
}

/** True only if `token` is live, unexpired, and was issued to exactly this
 *  member - a token minted for one Owner can never unlock the tab for
 *  another, even if both are verified. */
export function verifyUnlockToken(token, memberId) {
  const raw = String(token || "");
  if (!raw) return false;
  const key = hash(raw);
  const entry = tokens.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    tokens.delete(key);
    return false;
  }
  const expectedMemberIdBuf = Buffer.from(String(memberId || ""));
  const actualMemberIdBuf = Buffer.from(String(entry.memberId || ""));
  if (expectedMemberIdBuf.length !== actualMemberIdBuf.length) return false;
  return timingSafeEqual(expectedMemberIdBuf, actualMemberIdBuf);
}

export function revokeUnlockToken(token) {
  tokens.delete(hash(String(token || "")));
}

export function __clearAllUnlockTokensForTests() {
  tokens.clear();
}
