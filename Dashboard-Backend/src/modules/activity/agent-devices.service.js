import crypto from "node:crypto";
import { query } from "../../lib/postgres/client.js";


const MAX_FAILED_ATTEMPTS = 10;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function hashesEqual(a, b) {
  const bufA = Buffer.from(String(a), "hex");
  const bufB = Buffer.from(String(b), "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function newDeviceId() {
  return crypto.randomUUID();
}

export async function registerAgentDevice(input) {
  const memberId = String(input.memberId || "").trim();
  const deviceId = String(input.deviceId || "").trim();
  const agentSecret = String(input.agentSecret || "");
  if (!memberId || !deviceId || !agentSecret) return null;

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

export async function revokeAgentDevice(deviceId) {
  await query(
    "UPDATE agent_devices SET revoked_at = now(), updated_at = now() WHERE device_id = $1 AND revoked_at IS NULL",
    [String(deviceId || "").trim()],
  );
}

export async function revokeAgentDevicesForMember(memberId) {
  const id = String(memberId || "").trim();
  if (!id) return 0;
  const rows = await query(
    "UPDATE agent_devices SET revoked_at = now(), updated_at = now() WHERE member_id = $1 AND revoked_at IS NULL RETURNING device_id",
    [id],
  );
  return rows.length;
}

export async function getAgentDevice(deviceId) {
  const rows = await query(
    `SELECT device_id, member_id, ownership, revoked_at FROM agent_devices WHERE device_id = $1 LIMIT 1`,
    [String(deviceId || "").trim()],
  );
  return rows[0] ?? null;
}

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
