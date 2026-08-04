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
 * @param {{ memberId: string, deviceId: string, agentSecret: string, agentSource?: string, vmDetected?: boolean, vmSignals?: string[] }} input
 */
export async function registerAgentDevice(input) {
  const memberId = String(input.memberId || "").trim();
  const deviceId = String(input.deviceId || "").trim();
  const agentSecret = String(input.agentSecret || "");
  if (!memberId || !deviceId || !agentSecret) return null;

  // AC-3: reported by the agent itself once at registration - never
  // re-derived or verified server-side, since it's a device signal, not a
  // security boundary. `null` (not sent by an older agent) leaves whatever
  // was already stored untouched rather than resetting a real prior finding
  // to false.
  const vmDetected = typeof input.vmDetected === "boolean" ? input.vmDetected : null;
  const vmSignals = Array.isArray(input.vmSignals) ? input.vmSignals.slice(0, 20).join(",").slice(0, 500) : null;

  const rows = await query(
    `INSERT INTO agent_devices (member_id, device_id, secret_hash, agent_source, last_seen_at, vm_detected, vm_signals, vm_detected_at)
     VALUES ($1, $2, $3, $4, now(), COALESCE($5, false), $6, CASE WHEN $5 IS NOT NULL THEN now() ELSE NULL END)
     ON CONFLICT (device_id) DO UPDATE
       SET member_id = EXCLUDED.member_id,
           secret_hash = EXCLUDED.secret_hash,
           agent_source = EXCLUDED.agent_source,
           revoked_at = NULL,
           failed_attempts = 0,
           last_seen_at = now(),
           updated_at = now(),
           vm_detected = COALESCE($5, agent_devices.vm_detected),
           vm_signals = COALESCE($6, agent_devices.vm_signals),
           vm_detected_at = CASE WHEN $5 IS NOT NULL THEN now() ELSE agent_devices.vm_detected_at END
     RETURNING device_id, member_id`,
    [memberId, deviceId, hashSecret(agentSecret), input.agentSource || "tauri", vmDetected, vmSignals],
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

/** CF-6: a single device row (any status), for ownership-check call sites that need to know who owns it before allowing a self-classification. @param {string} deviceId */
export async function getAgentDevice(deviceId) {
  const rows = await query(
    `SELECT device_id, member_id, ownership, revoked_at FROM agent_devices WHERE device_id = $1 LIMIT 1`,
    [String(deviceId || "").trim()],
  );
  return rows[0] ?? null;
}

/**
 * CF-6/AC-3: every non-revoked device linked to a member, with its ownership
 * classification and AC-3's VM signal - the two device-level context flags a
 * manager weighs together (a VM flag on a company-owned box reads very
 * differently than one on a declared-personal machine).
 * @param {string} memberId
 */
export async function listAgentDevicesForMember(memberId) {
  const id = String(memberId || "").trim();
  if (!id) return [];
  return query(
    `SELECT device_id, agent_source, ownership, ownership_set_by, ownership_set_at, last_seen_at, created_at,
            vm_detected, vm_signals, vm_detected_at
     FROM agent_devices WHERE member_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [id],
  );
}

/**
 * CF-6: classify a linked device as company-owned, personal (BYOD), or back
 * to unspecified. `setBy` is recorded regardless of who it is (the device's
 * own owner self-declaring, or management correcting it) - "recorded and
 * auditable" means knowing who classified it, not just what it's set to.
 * @param {string} deviceId @param {'company'|'personal'|'unspecified'} ownership @param {string} setBy
 */
export async function setAgentDeviceOwnership(deviceId, ownership, setBy) {
  if (!["company", "personal", "unspecified"].includes(ownership)) {
    const err = new Error(`Unknown ownership value: ${ownership}`);
    err.code = "UNKNOWN_OWNERSHIP";
    throw err;
  }
  const rows = await query(
    `UPDATE agent_devices SET ownership = $2, ownership_set_by = $3, ownership_set_at = now(), updated_at = now()
     WHERE device_id = $1 AND revoked_at IS NULL
     RETURNING device_id, member_id, ownership, ownership_set_by, ownership_set_at`,
    [String(deviceId || "").trim(), ownership, setBy ?? null],
  );
  return rows[0] ?? null;
}
