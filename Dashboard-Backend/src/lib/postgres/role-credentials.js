import crypto from "node:crypto";

/**
 * Login credentials for the restricted database roles (vt_app,
 * vt_readonly_crosstenant), derived rather than stored.
 *
 * Each role's password is HMAC-SHA256(<password of the superuser
 * POSTGRES_URL>, "vt-role:" + role). Only someone who already holds the
 * superuser credential can compute it, so deriving it grants nothing new; it
 * is identical on every instance and every restart (rolling deploys keep
 * working), and it rotates by itself if the superuser password is rotated.
 * Nobody ever types, stores, or pastes it.
 *
 * The database is given a SCRAM-SHA-256 verifier computed here, never the
 * plaintext, so the password cannot surface in server logs or
 * pg_stat_statements via the ALTER ROLE that sets it.
 */

const SCRAM_ITERATIONS = 4096;

function superuserPassword(superuserUrl) {
  if (!superuserUrl) return null;
  try {
    const password = decodeURIComponent(new URL(superuserUrl).password);
    return password || null;
  } catch {
    return null;
  }
}

export function deriveRolePassword(superuserUrl, roleName) {
  const secret = superuserPassword(superuserUrl);
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(`vt-role:${roleName}`).digest("hex");
}

/** RFC 5802 / 7677 verifier in the exact form Postgres stores in pg_authid:
 *  SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>. */
export function scramVerifier(password, salt = crypto.randomBytes(16)) {
  const salted = crypto.pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = crypto.createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const serverKey = crypto.createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** The superuser URL with its user and password swapped for the role's. */
export function roleConnectionString(superuserUrl, roleName) {
  const password = deriveRolePassword(superuserUrl, roleName);
  if (!password) return null;
  const url = new URL(superuserUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}
