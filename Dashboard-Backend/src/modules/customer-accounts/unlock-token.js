import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { queryAsAdmin } from "../../lib/postgres/client.js";

/**
 * The token a verified Owner/Super Admin holds after unlock/verify, bound to
 * every mutating Customer Accounts endpoint (PLAN-customer-accounts-and-
 * tenancy.md §16.3). Possession of the raw value is the credential: only its
 * SHA-256 is stored, so a leaked table row cannot be replayed.
 *
 * Stored in the control-plane table customer_account_unlock_tokens rather
 * than process memory, so a token minted on one instance verifies on every
 * other one - an in-memory map made the unlock flow fail at random on any
 * multi-replica deployment. Control-plane, hence the admin identity: this is
 * platform bookkeeping, not a tenant's data.
 */
const TOKEN_TTL_MINUTES = 20;

function hash(raw) {
  return createHash("sha256").update(String(raw)).digest("hex");
}

/** Mints a fresh token for a member, invalidating any token they already
 *  held - a member only ever has one active unlock, which is also what makes
 *  "closing the tab locks it again" true even if the client merely drops its
 *  copy without an explicit revoke. Expired rows are pruned on the way. */
export async function issueUnlockToken(memberId) {
  const raw = randomBytes(32).toString("hex");
  await queryAsAdmin(`DELETE FROM customer_account_unlock_tokens WHERE member_id = $1 OR expires_at <= now()`, [
    memberId,
  ]);
  await queryAsAdmin(
    `INSERT INTO customer_account_unlock_tokens (token_hash, member_id, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [hash(raw), memberId, TOKEN_TTL_MINUTES],
  );
  return raw;
}

/** True only if `token` is live, unexpired, and was issued to exactly this
 *  member - a token minted for one Owner can never unlock another's tab. */
export async function verifyUnlockToken(token, memberId) {
  const raw = String(token || "");
  if (!raw) return false;
  const rows = await queryAsAdmin(
    `SELECT member_id FROM customer_account_unlock_tokens WHERE token_hash = $1 AND expires_at > now() LIMIT 1`,
    [hash(raw)],
  );
  const entry = rows[0];
  if (!entry) return false;
  const expected = Buffer.from(String(memberId || ""));
  const actual = Buffer.from(String(entry.member_id || ""));
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function revokeUnlockToken(token) {
  await queryAsAdmin(`DELETE FROM customer_account_unlock_tokens WHERE token_hash = $1`, [hash(String(token || ""))]);
}
