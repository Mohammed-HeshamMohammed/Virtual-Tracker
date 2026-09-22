import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { query } from "../../lib/postgres/client.js";

export const UNLOCK_PURPOSE = "customer_accounts_tab";
export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const REQUEST_LIMIT = 3;
export const REQUEST_WINDOW_MINUTES = 15;

/**
 * A 6-digit code is only a 1,000,000-value space - small enough that a bare
 * hash of it is reversible offline in well under a second if the table ever
 * leaks (unlike agent_devices.secret_hash, which hashes a high-entropy
 * random token and can get away with plain SHA-256 - see
 * agent-devices.service.js's hashSecret). scrypt with a per-code random
 * salt is the standard answer for a low-entropy secret: its cost parameter
 * makes brute-forcing the whole space expensive even offline, which a bare
 * hash cannot do regardless of algorithm.
 */
function hashCode(code, salt) {
  return scryptSync(code, salt, 32).toString("hex");
}

function encodeHash(code) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${hashCode(code, salt)}`;
}

function verifyEncodedHash(code, encoded) {
  const [salt, expectedHex] = String(encoded || "").split(":");
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from(hashCode(code, salt), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Cryptographically random, zero-padded to 6 digits - randomInt (not
 *  Math.random) because this gates a real authorization decision. */
function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Rate limits code REQUESTS at 3 per 15 minutes per member (spec: "Code
 * requests are rate-limited"). Deliberately separate from
 * http/rate-limit.js's checkRateLimit: that one keys by IP/token in fixed
 * 60s windows for every API route; this is member-keyed (the caller is
 * already authenticated by the time this runs) with a much longer window
 * that specifically matters for THIS one endpoint, and mixing the two
 * concerns would make either harder to reason about.
 */
export async function assertUnlockRequestAllowed(memberId) {
  const since = new Date(Date.now() - REQUEST_WINDOW_MINUTES * 60 * 1000).toISOString();
  const rows = await query(
    `SELECT count(*)::int AS count FROM verification_codes
     WHERE member_id = $1 AND purpose = $2 AND created_at >= $3`,
    [memberId, UNLOCK_PURPOSE, since],
  );
  const count = rows[0]?.count ?? 0;
  if (count >= REQUEST_LIMIT) {
    const err = new Error(
      `Too many verification codes requested. Try again in ${REQUEST_WINDOW_MINUTES} minutes.`,
    );
    err.code = "RATE_LIMITED";
    err.status = 429;
    throw err;
  }
}

/**
 * Generates, hashes and stores a new code, returning the PLAINTEXT for the
 * caller to email immediately - it is never persisted or logged, only ever
 * held in memory for the length of that one send.
 */
export async function issueUnlockCode(memberId) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
  await query(
    `INSERT INTO verification_codes (member_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [memberId, UNLOCK_PURPOSE, encodeHash(code), expiresAt],
  );
  return { code, expiresInMinutes: CODE_TTL_MINUTES };
}

/**
 * Verifies a submitted code against the member's most recent unused,
 * unexpired one. Wrong code increments attempts and can permanently
 * invalidate the code (5 wrong attempts, per spec); right code marks it
 * used so it cannot be replayed.
 */
export async function verifyUnlockCode(memberId, submittedCode) {
  const candidate = String(submittedCode || "").trim();
  if (!/^\d{6}$/.test(candidate)) {
    return { ok: false, error: "Enter the 6-digit code." };
  }

  const rows = await query(
    `SELECT id, code_hash, expires_at, attempts, used_at FROM verification_codes
     WHERE member_id = $1 AND purpose = $2
     ORDER BY created_at DESC LIMIT 1`,
    [memberId, UNLOCK_PURPOSE],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "Request a new code first." };
  }
  if (row.used_at) {
    return { ok: false, error: "This code has already been used. Request a new one." };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "Too many wrong attempts. Request a new code." };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: "This code has expired. Request a new one." };
  }

  if (!verifyEncodedHash(candidate, row.code_hash)) {
    const rows2 = await query(
      `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
      [row.id],
    );
    const attemptsNow = rows2[0]?.attempts ?? row.attempts + 1;
    if (attemptsNow >= MAX_ATTEMPTS) {
      return { ok: false, error: "Too many wrong attempts. Request a new code." };
    }
    return { ok: false, error: "Incorrect code.", attemptsRemaining: MAX_ATTEMPTS - attemptsNow };
  }

  await query(`UPDATE verification_codes SET used_at = now() WHERE id = $1`, [row.id]);
  return { ok: true };
}
