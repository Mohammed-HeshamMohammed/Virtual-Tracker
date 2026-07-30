import crypto from "node:crypto";
import { query } from "../../lib/postgres/client.js";

/**
 * Long-lived per-device credential for the desktop agent.
 *
 * Why this exists: the link flow hands the agent the *web app's* Firebase
 * refresh token, so the agent has no credential of its own. Once Firebase
 * rejects that borrowed token the agent cannot re-authenticate at all, and the
 * only cure is another browser round trip. This gives each linked machine its
 * own secret so it can recover in-app. See agent-reconnect-plan.md §4.2a.
 *
 * The secret is only ever stored here as a SHA-256 hash - a database leak must
 * not yield usable agent credentials.
 */

const MAX_FAILED_ATTEMPTS = 10;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

/** Constant-time compare so a wrong secret can't be recovered by timing. */
function hashesEqual(a, b) {
  const bufA = Buffer.from(String(a), "hex");
  const bufB = Buffer.from(String(b), "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function newDeviceId() {
  return crypto.randomUUID();
}

/**
 * Records (or re-records) a linked machine. Re-linking the same device rotates
 * its secret rather than accumulating rows.
 * @param {{ memberId: string, deviceId: string, agentSecret: string, agentSource?: string }} input
 */
export async function registerAgentDevice(input) {
  const memberId = String(input.memberId || "").trim();
  const deviceId = String(input.deviceId || "").trim();
  const agentSecret = String(input.agentSecret || "");
  if (!memberId || !deviceId || !agentSecret) return null;

  const rows = await query(
    `INSERT INTO agent_devices (member_id, device_id, secret_hash, agent_source, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (device_id) DO UPDATE
       SET member_id = EXCLUDED.member_id,
           secret_hash = EXCLUDED.secret_hash,
           agent_source = EXCLUDED.agent_source,
           revoked_at = NULL,
           failed_attempts = 0,
           last_seen_at = now(),
           updated_at = now()
     RETURNING device_id, member_id`,
    [memberId, deviceId, hashSecret(agentSecret), input.agentSource || "tauri"],
  );
  return rows[0] ?? null;
}

/**
 * Verifies a device credential. Returns the owning member id, or a reason.
 * Deliberately returns the same generic error for unknown/revoked/mismatched
 * so a caller cannot probe which device ids exist.
 * @param {string} deviceId
 * @param {string} agentSecret
 */
export async function verifyAgentDevice(deviceId, agentSecret) {
  const id = String(deviceId || "").trim();
  const secret = String(agentSecret || "");
  if (!id || !secret) return { ok: false, error: "Unknown device" };

  const rows = await query(
    "SELECT device_id, member_id, secret_hash, revoked_at, failed_attempts FROM agent_devices WHERE device_id = $1 LIMIT 1",
    [id],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return { ok: false, error: "Unknown device" };

  if (Number(row.failed_attempts ?? 0) >= MAX_FAILED_ATTEMPTS) {
    await revokeAgentDevice(id);
    return { ok: false, error: "Unknown device" };
  }

  if (!hashesEqual(row.secret_hash, hashSecret(secret))) {
    await query(
      "UPDATE agent_devices SET failed_attempts = failed_attempts + 1, updated_at = now() WHERE device_id = $1",
      [id],
    );
    return { ok: false, error: "Unknown device" };
  }

  await query(
    "UPDATE agent_devices SET failed_attempts = 0, last_seen_at = now(), updated_at = now() WHERE device_id = $1",
    [id],
  );
  return { ok: true, memberId: String(row.member_id) };
}

/** @param {string} deviceId */
export async function revokeAgentDevice(deviceId) {
  await query(
    "UPDATE agent_devices SET revoked_at = now(), updated_at = now() WHERE device_id = $1 AND revoked_at IS NULL",
    [String(deviceId || "").trim()],
  );
}

/**
 * Kills every device belonging to a member. Must be called anywhere an account
 * loses access (ban, removal, deactivation) - a device credential that
 * outlives the account it belongs to is a way back in for someone who was
 * deliberately cut off.
 * @param {string} memberId
 */
export async function revokeAgentDevicesForMember(memberId) {
  const id = String(memberId || "").trim();
  if (!id) return 0;
  const rows = await query(
    "UPDATE agent_devices SET revoked_at = now(), updated_at = now() WHERE member_id = $1 AND revoked_at IS NULL RETURNING device_id",
    [id],
  );
  return rows.length;
}
