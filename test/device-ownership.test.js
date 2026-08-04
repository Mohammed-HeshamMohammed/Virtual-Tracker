// Guards CF-6 (device ownership) and AC-3 (VM-detection signal storage).
// setAgentDeviceOwnership records who classified the device and when, and
// getAgentDevice/listAgentDevicesForMember are what routes.js uses to
// authorize a self-classification. registerAgentDevice's AC-3 behavior:
// a `null` vmDetected (an agent that didn't send one) must never overwrite
// a previously stored real finding with false.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {Map<string, any>} */
let devices;
let queryLog;

mock.module("../src/lib/postgres/client.js", {
  exports: {
    query: async (sql, params = []) => {
      queryLog.push({ sql, params });

      if (sql.includes("SELECT device_id, member_id, ownership, revoked_at FROM agent_devices WHERE device_id")) {
        const row = devices.get(params[0]);
        return row ? [row] : [];
      }
      if (sql.includes("SELECT device_id, agent_source, ownership")) {
        return [...devices.values()].filter((d) => d.member_id === params[0] && !d.revoked_at);
      }
      if (sql.startsWith("UPDATE agent_devices SET ownership = $2")) {
        const [deviceId, ownership, setBy] = params;
        const row = devices.get(deviceId);
        if (!row || row.revoked_at) return [];
        row.ownership = ownership;
        row.ownership_set_by = setBy;
        row.ownership_set_at = new Date().toISOString();
        return [{ device_id: row.device_id, member_id: row.member_id, ownership, ownership_set_by: setBy, ownership_set_at: row.ownership_set_at }];
      }
      if (sql.includes("INSERT INTO agent_devices (member_id, device_id, secret_hash, agent_source")) {
        const [memberId, deviceId, secretHash, agentSource, vmDetected, vmSignals] = params;
        const existing = devices.get(deviceId);
        const row = {
          device_id: deviceId,
          member_id: memberId,
          secret_hash: secretHash,
          agent_source: agentSource,
          revoked_at: null,
          failed_attempts: 0,
          ownership: existing?.ownership ?? "unspecified",
          // Mirrors the real COALESCE($5, ...) / CASE-on-$5 semantics: a null
          // vmDetected must fall back to whatever was already stored.
          vm_detected: vmDetected !== null ? vmDetected : (existing?.vm_detected ?? false),
          vm_signals: vmSignals !== null ? vmSignals : (existing?.vm_signals ?? null),
          vm_detected_at: vmDetected !== null ? new Date().toISOString() : (existing?.vm_detected_at ?? null),
          created_at: existing?.created_at ?? new Date().toISOString(),
        };
        devices.set(deviceId, row);
        return [{ device_id: row.device_id, member_id: row.member_id }];
      }
      throw new Error(`Unhandled query in test mock: ${sql}`);
    },
  },
});

const { getAgentDevice, listAgentDevicesForMember, setAgentDeviceOwnership, registerAgentDevice } = await import(
  "../src/modules/activity/agent-devices.service.js"
);

function reset() {
  queryLog = [];
  devices = new Map([
    [
      "device-1",
      { device_id: "device-1", member_id: "member-1", ownership: "unspecified", revoked_at: null, created_at: new Date().toISOString() },
    ],
    [
      "device-2",
      { device_id: "device-2", member_id: "member-2", ownership: "unspecified", revoked_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ],
  ]);
}

test("a newly linked device defaults to unspecified, not company", async () => {
  reset();
  const device = await getAgentDevice("device-1");
  assert.equal(device.ownership, "unspecified");
});

test("setting ownership records who set it and when", async () => {
  reset();
  const updated = await setAgentDeviceOwnership("device-1", "personal", "member-1");
  assert.equal(updated.ownership, "personal");
  assert.equal(updated.ownership_set_by, "member-1");
  assert.ok(updated.ownership_set_at);
});

test("an invalid ownership value is rejected before touching storage", async () => {
  reset();
  await assert.rejects(
    () => setAgentDeviceOwnership("device-1", "work-and-personal", "member-1"),
    /Unknown ownership value/i,
  );
  assert.equal((await getAgentDevice("device-1")).ownership, "unspecified");
});

test("a revoked device cannot be classified", async () => {
  reset();
  const result = await setAgentDeviceOwnership("device-2", "company", "member-2");
  assert.equal(result, null, "the UPDATE's revoked_at IS NULL guard means a revoked device is never matched");
});

test("listAgentDevicesForMember only returns that member's non-revoked devices", async () => {
  reset();
  const list = await listAgentDevicesForMember("member-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].device_id, "device-1");
});

test("listAgentDevicesForMember excludes a revoked device even for its own owner", async () => {
  reset();
  const list = await listAgentDevicesForMember("member-2");
  assert.equal(list.length, 0);
});

test("registering a device with a VM signal stores it", async () => {
  reset();
  await registerAgentDevice({
    memberId: "member-3",
    deviceId: "device-3",
    agentSecret: "s3cret",
    vmDetected: true,
    vmSignals: ["cpuid_hypervisor_bit", "cpuid_vendor:VMwareVMware"],
  });
  const stored = devices.get("device-3");
  assert.equal(stored.vm_detected, true);
  assert.equal(stored.vm_signals, "cpuid_hypervisor_bit,cpuid_vendor:VMwareVMware");
  assert.ok(stored.vm_detected_at);
});

test("registering without a VM signal at all defaults to not-detected, not null/undefined", async () => {
  reset();
  await registerAgentDevice({ memberId: "member-4", deviceId: "device-4", agentSecret: "s4cret" });
  const stored = devices.get("device-4");
  assert.equal(stored.vm_detected, false);
  assert.equal(stored.vm_signals, null);
});

test("re-registering (reauth) without a VM field never overwrites a previously stored real finding", async () => {
  reset();
  await registerAgentDevice({
    memberId: "member-3",
    deviceId: "device-3",
    agentSecret: "s3cret",
    vmDetected: true,
    vmSignals: ["cpuid_hypervisor_bit"],
  });
  // A later reauth call from an agent build that doesn't send vmDetected at all.
  await registerAgentDevice({ memberId: "member-3", deviceId: "device-3", agentSecret: "new-secret" });
  const stored = devices.get("device-3");
  assert.equal(stored.vm_detected, true, "the earlier real finding must survive a re-registration with no VM field");
  assert.equal(stored.vm_signals, "cpuid_hypervisor_bit");
});
