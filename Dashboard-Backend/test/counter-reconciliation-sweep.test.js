// Guards the OBS-1 sweep job's wiring: it must record a security event per
// drifted member for both comparisons (yesterday's session/rollup totals,
// and the lifetime task-progress/rollup totals) and must never call anything
// that writes a correction back to either store.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let sessionTotals = new Map();
let rollupTotals = new Map();
let taskProgressTotals = new Map();
let lifetimeRollupTotals = new Map();
let recordedEvents = [];

mock.module("../src/lib/postgres/counter-reconciliation-postgres.service.js", {
  namedExports: {
    fetchSessionActiveSecondsByMemberForDayPg: async () => sessionTotals,
    fetchDailyRollupByMemberForDayPg: async () => rollupTotals,
    fetchLifetimeTaskProgressByMemberPg: async () => taskProgressTotals,
    fetchLifetimeDailyRollupByMemberPg: async () => lifetimeRollupTotals,
  },
});
mock.module("../src/core/metrics.js", {
  namedExports: {
    recordSecurityEvent: (evt) => {
      recordedEvents.push(evt);
    },
  },
});

const { reconcileCounters } = await import("../src/modules/activity/counter-reconciliation-sweep.service.js");

function reset() {
  sessionTotals = new Map();
  rollupTotals = new Map();
  taskProgressTotals = new Map();
  lifetimeRollupTotals = new Map();
  recordedEvents = [];
}

test("agreeing stores record nothing", async () => {
  reset();
  sessionTotals = new Map([["m1", 100]]);
  rollupTotals = new Map([["m1", 100]]);
  taskProgressTotals = new Map([["m1", 500]]);
  lifetimeRollupTotals = new Map([["m1", 500]]);
  await reconcileCounters();
  assert.equal(recordedEvents.length, 0);
});

test("a daily session/rollup mismatch records a daily_counter_drift event", async () => {
  reset();
  sessionTotals = new Map([["m1", 3600]]);
  rollupTotals = new Map([["m1", 3000]]);
  await reconcileCounters();
  const drift = recordedEvents.find((e) => e.event === "daily_counter_drift");
  assert.ok(drift, "expected a daily_counter_drift event");
  assert.match(drift.detail, /member=m1/);
  assert.match(drift.detail, /diff=600s/);
});

test("a lifetime task-progress/rollup mismatch records a lifetime_counter_drift event", async () => {
  reset();
  taskProgressTotals = new Map([["m2", 10000]]);
  lifetimeRollupTotals = new Map([["m2", 9000]]);
  await reconcileCounters();
  const drift = recordedEvents.find((e) => e.event === "lifetime_counter_drift");
  assert.ok(drift, "expected a lifetime_counter_drift event");
  assert.match(drift.detail, /member=m2/);
  assert.match(drift.detail, /diff=1000s/);
});

test("both checks run independently - a drift in one does not suppress or duplicate the other", async () => {
  reset();
  sessionTotals = new Map([["m1", 100]]);
  rollupTotals = new Map([["m1", 50]]);
  taskProgressTotals = new Map([["m1", 900]]);
  lifetimeRollupTotals = new Map([["m1", 800]]);
  await reconcileCounters();
  assert.equal(recordedEvents.length, 2);
  assert.deepEqual(
    recordedEvents.map((e) => e.event).sort(),
    ["daily_counter_drift", "lifetime_counter_drift"],
  );
});
