// Switching a capability off used to look exactly like a tracker that had
// stopped working: the data never arrived and nothing said why. These cover the
// count of what was discarded, and the report that turns it into "this is off,
// and this much was thrown away".
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const calls = [];
let dropRows = [];
let policy = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM capture_policy_drops")) return dropRows;
      return [];
    },
  },
});
mock.module("../src/modules/compliance/monitoring-policy.js", {
  namedExports: { getMonitoringPolicy: async () => policy },
});

const { recordPolicyDrops, getPolicyHealth } = await import("../src/modules/compliance/policy-health.js");

const cap = (capability, over = {}) => ({
  capability,
  enabled: false,
  enforced: true,
  lawfulBasis: null,
  ...over,
});

function reset() {
  calls.length = 0;
  dropRows = [];
  policy = [];
}

test("one upsert per capability that actually dropped something", async () => {
  reset();
  await recordPolicyDrops("m1", { screenshots: 3, url_capture: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.params).sort(), [["m1", "screenshots", 3], ["m1", "url_capture", 1]].sort());
});

test("the upsert accumulates within a day rather than overwriting", async () => {
  reset();
  await recordPolicyDrops("m1", { screenshots: 2 });
  assert.match(calls[0].sql, /dropped = capture_policy_drops\.dropped \+ EXCLUDED\.dropped/);
});

test("nothing dropped means no database call at all", async () => {
  reset();
  await recordPolicyDrops("m1", {});
  await recordPolicyDrops("m1", { screenshots: 0, app_tracking: -4, junk: "x" });
  assert.equal(calls.length, 0, "the normal path must cost nothing");
});

test("without a member there is nothing to attribute the drops to", async () => {
  reset();
  await recordPolicyDrops("", { screenshots: 5 });
  assert.equal(calls.length, 0);
});

test("a capability that is off and being discarded is flagged as urgent", async () => {
  reset();
  policy = [cap("screenshots"), cap("app_tracking", { enabled: true, lawfulBasis: "legitimate_interest" })];
  dropRows = [{ capability: "screenshots", dropped: 42, members: 5 }];
  const h = await getPolicyHealth();
  const shots = h.capabilities.find((c) => c.capability === "screenshots");
  assert.equal(shots.discarding, true);
  assert.equal(shots.dropped, 42);
  assert.equal(shots.members, 5);
  assert.equal(h.discarding, true);
  assert.equal(h.needsAttention, true);
});

test("a capability that was dropped earlier but is now on stops alarming", async () => {
  reset();
  policy = [cap("screenshots", { enabled: true, lawfulBasis: "consent" })];
  dropRows = [{ capability: "screenshots", dropped: 42, members: 5 }];
  const h = await getPolicyHealth();
  assert.equal(h.capabilities[0].discarding, false);
  assert.equal(h.capabilities[0].dropped, 0, "past drops are history once it is enabled");
  assert.equal(h.needsAttention, false);
});

test("a capability that is off but nothing has arrived for is not urgent", async () => {
  reset();
  policy = [cap("url_capture")];
  const h = await getPolicyHealth();
  assert.equal(h.capabilities[0].discarding, false);
  assert.equal(h.needsAttention, false, "off by choice, nothing lost");
});

test("an enabled capability with no lawful basis on record needs attention, quietly", async () => {
  // The one-time backfill enables what was already in use but cannot know why.
  reset();
  policy = [cap("screenshots", { enabled: true, lawfulBasis: null })];
  const h = await getPolicyHealth();
  assert.equal(h.capabilities[0].needsBasis, true);
  assert.equal(h.needsAttention, true);
  assert.equal(h.discarding, false, "nothing is being lost, so it is not the urgent kind");
});

test("capabilities nothing reads are left out, so they are never presented as working", async () => {
  reset();
  policy = [cap("screenshots"), cap("dns_logging", { enforced: false }), cap("activity_metering", { enforced: false })];
  const h = await getPolicyHealth();
  assert.deepEqual(h.capabilities.map((c) => c.capability), ["screenshots"]);
});

test("the window is clamped, so a huge value cannot scan the whole table", async () => {
  reset();
  await getPolicyHealth({ days: 100000 });
  assert.equal(calls.find((c) => c.sql.includes("capture_policy_drops")).params[0], 30);
  await getPolicyHealth({ days: -5 });
  assert.ok(calls.filter((c) => c.sql.includes("capture_policy_drops")).at(-1).params[0] >= 1);
});
