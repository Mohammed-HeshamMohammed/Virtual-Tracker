// monitoring_capabilities has existed since the compliance work landed, with
// every row defaulting to enabled = false and isCapabilityEnabled having no
// callers - so an organization could record "URL capture: off" and have URLs
// captured anyway. These cover the gate that now enforces it, and the one-shot
// backfill that stops enforcement turning capture off on deploy.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let rows = [];
let existsRow = {};
let backfillDone = [];
const executed = [];
let failQuery = false;

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      executed.push({ sql, params });
      if (failQuery) throw new Error("postgres down");
      if (sql.includes("FROM monitoring_capabilities")) return rows;
      if (sql.includes("FROM system_meta")) return backfillDone;
      if (sql.includes("EXISTS (SELECT 1 FROM activity_screenshots)")) return [existsRow];
      return [];
    },
  },
});

const {
  enabledCapabilities,
  eventAllowed,
  isEnforcedCapability,
  backfillCapabilitiesInUse,
  __resetCapabilityCacheForTests,
} = await import("../src/modules/compliance/capability-gate.js");

function reset() {
  executed.length = 0;
  failQuery = false;
  rows = [];
  existsRow = {};
  backfillDone = [];
  __resetCapabilityCacheForTests();
}

test("an event whose capability is enabled is stored", async () => {
  reset();
  rows = [{ capability: "screenshots" }, { capability: "url_capture" }];
  const enabled = await enabledCapabilities({ refresh: true });
  assert.equal(eventAllowed("screenshot", enabled), true);
  assert.equal(eventAllowed("url", enabled), true);
});

test("an event whose capability is disabled is dropped", async () => {
  reset();
  rows = [{ capability: "screenshots" }];
  const enabled = await enabledCapabilities({ refresh: true });
  assert.equal(eventAllowed("app", enabled), false, "app_tracking is off");
  assert.equal(eventAllowed("url", enabled), false, "url_capture is off");
});

test("an event type no capability governs is always allowed", async () => {
  reset();
  const enabled = await enabledCapabilities({ refresh: true });
  assert.equal(eventAllowed("heartbeat", enabled), true);
});

test("a failed policy read allows capture rather than discarding tracked work", async () => {
  // The read failed, not the policy. Dropping a member's hours because a
  // lookup broke would be the worse outcome of the two.
  reset();
  failQuery = true;
  const enabled = await enabledCapabilities({ refresh: true });
  assert.equal(eventAllowed("screenshot", enabled), true);
  assert.equal(eventAllowed("app", enabled), true);
});

test("the policy is cached rather than read on every batch", async () => {
  reset();
  rows = [{ capability: "screenshots" }];
  await enabledCapabilities({ refresh: true });
  const after = executed.length;
  await enabledCapabilities();
  await enabledCapabilities();
  assert.equal(executed.length, after, "ingest reads this per batch; it must not hit the database each time");
});

test("only capabilities that actually stop collection report as enforced", async () => {
  for (const c of ["screenshots", "app_tracking", "url_capture", "integrity_signals"]) {
    assert.equal(isEnforcedCapability(c), true, c);
  }
  // Declared in KNOWN_CAPABILITIES but nothing reads them, so the console must
  // not present them as working switches.
  for (const c of ["activity_metering", "dns_logging"]) {
    assert.equal(isEnforcedCapability(c), false, c);
  }
});

test("the backfill enables only the capabilities with data behind them", async () => {
  reset();
  existsRow = { screenshots: true, app_tracking: true, url_capture: false, integrity_signals: false };
  const result = await backfillCapabilitiesInUse();
  assert.deepEqual(result.enabled, ["screenshots", "app_tracking"]);

  const update = executed.find((q) => q.sql.includes("UPDATE monitoring_capabilities"));
  assert.ok(update, "the ones in use are enabled");
  assert.deepEqual(update.params[0], ["screenshots", "app_tracking"]);
  // Never re-enables one an Owner has since turned off.
  assert.match(update.sql, /AND enabled = false/);
});

test("the backfill runs once and never re-enables afterwards", async () => {
  reset();
  backfillDone = [{ "?column?": 1 }];
  const result = await backfillCapabilitiesInUse();
  assert.equal(result.skipped, true);
  assert.ok(!executed.some((q) => q.sql.includes("UPDATE monitoring_capabilities")));
});

test("an organization with no data at all enables nothing", async () => {
  reset();
  existsRow = { screenshots: false, app_tracking: false, url_capture: false, integrity_signals: false };
  const result = await backfillCapabilitiesInUse();
  assert.deepEqual(result.enabled, []);
  assert.ok(!executed.some((q) => q.sql.includes("UPDATE monitoring_capabilities")));
});

test("a failed backfill is reported rather than marked done", async () => {
  reset();
  failQuery = true;
  const result = await backfillCapabilitiesInUse();
  assert.equal(result.ok, false);
});
