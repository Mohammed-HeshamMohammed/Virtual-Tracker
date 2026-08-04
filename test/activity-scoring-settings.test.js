// Guards ACT-3: every server-tunable agent constant the plan names
// (scoring saturation/window, screenshot cadence, idle escalation
// thresholds) - admin-gated writes, validated inputs, defaults matching the
// pre-existing Rust constants so shipping this is a no-op until an admin
// actually tunes something.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let row;

mock.module("../src/lib/postgres/activity-scoring-postgres.service.js", {
  exports: {
    getActivityScoringSettingsPg: async () => row,
    setActivityScoringSettingsPg: async (input) => {
      row = {
        saturation_events: input.saturationEvents ?? row.saturation_events,
        window_ms: input.windowMs ?? row.window_ms,
        screenshot_min_delay_sec: input.screenshotMinDelaySec ?? row.screenshot_min_delay_sec,
        screenshot_max_delay_sec: input.screenshotMaxDelaySec ?? row.screenshot_max_delay_sec,
        idle_threshold_sec: input.idleThresholdSec ?? row.idle_threshold_sec,
        idle_warn_sec: input.idleWarnSec ?? row.idle_warn_sec,
        idle_alert_sec: input.idleAlertSec ?? row.idle_alert_sec,
        idle_stop_sec: input.idleStopSec ?? row.idle_stop_sec,
        updated_by: input.updatedBy ?? null,
        updated_at: new Date().toISOString(),
      };
      return row;
    },
  },
});

const { getActivityScoringSettings, setActivityScoringSettings } = await import(
  "../src/modules/activity/scoring-settings.js"
);

const ADMIN = { memberId: "admin-1", roleName: "Admin" };
const EMPLOYEE = { memberId: "employee-1", roleName: "Employee" };

function reset() {
  row = {
    saturation_events: 120,
    window_ms: 60000,
    screenshot_min_delay_sec: 90,
    screenshot_max_delay_sec: 210,
    idle_threshold_sec: 60,
    idle_warn_sec: 300,
    idle_alert_sec: 600,
    idle_stop_sec: 900,
    updated_by: null,
    updated_at: new Date().toISOString(),
  };
}

test("defaults match the pre-existing Rust constants", async () => {
  reset();
  const settings = await getActivityScoringSettings();
  assert.equal(settings.saturationEvents, 120);
  assert.equal(settings.windowMs, 60000);
  assert.equal(settings.screenshotMinDelaySec, 90);
  assert.equal(settings.screenshotMaxDelaySec, 210);
  assert.equal(settings.idleThresholdSec, 60);
  assert.equal(settings.idleWarnSec, 300);
  assert.equal(settings.idleAlertSec, 600);
  assert.equal(settings.idleStopSec, 900);
});

test("a non-management actor cannot change scoring settings", async () => {
  reset();
  await assert.rejects(() => setActivityScoringSettings({ saturationEvents: 200 }, EMPLOYEE), /FORBIDDEN|management/i);
  assert.equal((await getActivityScoringSettings()).saturationEvents, 120);
});

test("management can tune saturationEvents independent of windowMs", async () => {
  reset();
  const updated = await setActivityScoringSettings({ saturationEvents: 200 }, ADMIN);
  assert.equal(updated.saturationEvents, 200);
  assert.equal(updated.windowMs, 60000, "changing one field must not disturb the other");
});

test("management can tune one idle stage without disturbing the others", async () => {
  reset();
  const updated = await setActivityScoringSettings({ idleWarnSec: 120 }, ADMIN);
  assert.equal(updated.idleWarnSec, 120);
  assert.equal(updated.idleAlertSec, 600);
  assert.equal(updated.idleStopSec, 900);
});

test("zero or negative saturationEvents is rejected", async () => {
  reset();
  await assert.rejects(() => setActivityScoringSettings({ saturationEvents: 0 }, ADMIN), /INVALID_SATURATION_EVENTS|positive/i);
  await assert.rejects(() => setActivityScoringSettings({ saturationEvents: -10 }, ADMIN), /INVALID_SATURATION_EVENTS|positive/i);
});

test("zero or negative windowMs is rejected", async () => {
  reset();
  await assert.rejects(() => setActivityScoringSettings({ windowMs: 0 }, ADMIN), /INVALID_WINDOW_MS|positive/i);
});

test("a non-numeric value is rejected", async () => {
  reset();
  await assert.rejects(() => setActivityScoringSettings({ saturationEvents: "lots" }, ADMIN), /positive number/i);
});

test("an idle stage set out of order (warn >= alert) is rejected before touching storage", async () => {
  reset();
  await assert.rejects(() => setActivityScoringSettings({ idleWarnSec: 700 }, ADMIN), /idleWarnSec.*idleAlertSec.*idleStopSec/i);
  assert.equal((await getActivityScoringSettings()).idleWarnSec, 300, "the rejected write must not have landed");
});

test("a screenshot min delay set above the current max is rejected", async () => {
  reset();
  await assert.rejects(() => setActivityScoringSettings({ screenshotMinDelaySec: 999 }, ADMIN), /screenshotMinDelaySec.*screenshotMaxDelaySec/i);
});

test("raising min and max together in the same call is allowed when the pair stays ordered", async () => {
  reset();
  const updated = await setActivityScoringSettings({ screenshotMinDelaySec: 300, screenshotMaxDelaySec: 400 }, ADMIN);
  assert.equal(updated.screenshotMinDelaySec, 300);
  assert.equal(updated.screenshotMaxDelaySec, 400);
});

test("ordering validation runs before the management gate, but neither leaks a write", async () => {
  reset();
  // An employee sending an out-of-order value should still be rejected -
  // whichever check fires first, storage must not change.
  await assert.rejects(() => setActivityScoringSettings({ idleWarnSec: 700 }, EMPLOYEE));
  assert.equal((await getActivityScoringSettings()).idleWarnSec, 300);
});
