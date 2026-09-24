import test, { mock } from "node:test";
import assert from "node:assert/strict";

let memberRow = {};
let timeSettingsRow = {};

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      if (sql.includes("FROM member_capture_settings")) return memberRow ? [memberRow] : [];
      if (sql.includes("FROM time_settings")) return timeSettingsRow ? [timeSettingsRow] : [];
      return [];
    },
  },
});
mock.module("../src/modules/activity/scoring-settings.js", {
  namedExports: {
    getActivityScoringSettings: async () => ({
      saturationEvents: 120,
      windowMs: 60000,
      screenshotMinDelaySec: 90,
      screenshotMaxDelaySec: 210,
      idleThresholdSec: 60,
    }),
  },
});
mock.module("../src/modules/reports/member-timezones.js", {
  namedExports: { getMemberTimezone: async () => "UTC" },
});

const { getEffectiveCaptureSettings, isOutsideWorkWindow } = await import(
  "../src/modules/activity/member-capture-settings.js"
);

const MINUTE = 60 * 1000;

function minutesNowUtc() {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

test("no member row inherits the org cadence and blocks nothing", async () => {
  memberRow = {};
  timeSettingsRow = {};
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.screenshotMinDelaySec, 90);
  assert.equal(s.screenshotMaxDelaySec, 210);
  assert.equal(s.blurDefault, false);
  assert.equal(s.captureBlocked, false);
  assert.equal(s.captureBlockReason, null);
});

test("a member override wins over the org cadence", async () => {
  memberRow = { screenshot_min_delay_sec: 600, screenshot_max_delay_sec: 1200, blur_default: true };
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.screenshotMinDelaySec, 600);
  assert.equal(s.screenshotMaxDelaySec, 1200);
  assert.equal(s.blurDefault, true);
});

test("a null override inherits rather than reading as zero", async () => {
  memberRow = { screenshot_min_delay_sec: null, screenshot_max_delay_sec: null };
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.screenshotMinDelaySec, 90);
});

test("an active break blocks capture and reports why", async () => {
  memberRow = { break_until: new Date(Date.now() + 10 * MINUTE), break_reason: "doctor" };
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.captureBlocked, true);
  assert.equal(s.captureBlockReason, "break");
  assert.equal(s.breakReason, "doctor");
  assert.ok(s.breakUntilMs > Date.now());
});

test("an expired break blocks nothing and leaks no reason", async () => {
  memberRow = { break_until: new Date(Date.now() - MINUTE), break_reason: "doctor" };
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.captureBlocked, false);
  assert.equal(s.breakUntilMs, 0);
  assert.equal(s.breakReason, null);
});

test("inside the work window capture is allowed, outside it is blocked", async () => {
  const minute = minutesNowUtc();
  memberRow = { work_start_min: Math.max(0, minute - 1), work_end_min: Math.min(1439, minute + 2) };
  assert.equal((await getEffectiveCaptureSettings("m1")).captureBlocked, false);

  memberRow = { work_start_min: (minute + 10) % 1440, work_end_min: (minute + 20) % 1440 };
  const blocked = await getEffectiveCaptureSettings("m1");
  assert.equal(blocked.captureBlocked, true);
  assert.equal(blocked.captureBlockReason, "outside_work_hours");
});

// Driven with a fixed clock: a window built relative to "now" only actually
// wraps midnight during the hour either side of it, so a relative test passes
// for the wrong reason for 22 hours a day.
test("an overnight window covers the night and excludes the afternoon", () => {
  const nightShift = { work_start_min: 22 * 60, work_end_min: 6 * 60 };
  const at = (h, m = 0) => new Date(Date.UTC(2026, 0, 15, h, m));

  for (const t of [at(22, 0), at(23, 30), at(0, 0), at(3, 0), at(5, 59)]) {
    assert.equal(isOutsideWorkWindow(nightShift, null, t, "UTC"), false, `${t.toISOString()} is on shift`);
  }
  for (const t of [at(6, 0), at(12, 0), at(21, 59)]) {
    assert.equal(isOutsideWorkWindow(nightShift, null, t, "UTC"), true, `${t.toISOString()} is off shift`);
  }
});

test("a same-day window excludes both sides of itself", () => {
  const nineToFive = { work_start_min: 9 * 60, work_end_min: 17 * 60 };
  const at = (h) => new Date(Date.UTC(2026, 0, 15, h));
  assert.equal(isOutsideWorkWindow(nineToFive, null, at(8), "UTC"), true);
  assert.equal(isOutsideWorkWindow(nineToFive, null, at(9), "UTC"), false);
  assert.equal(isOutsideWorkWindow(nineToFive, null, at(16), "UTC"), false);
  // End is exclusive: 17:00 is the first minute off shift, not the last on it.
  assert.equal(isOutsideWorkWindow(nineToFive, null, at(17), "UTC"), true);
});

test("the window is read in the member's timezone, not the server's", () => {
  const nineToFive = { work_start_min: 9 * 60, work_end_min: 17 * 60 };
  const noonUtc = new Date(Date.UTC(2026, 0, 15, 12));
  assert.equal(isOutsideWorkWindow(nineToFive, null, noonUtc, "UTC"), false);
  // Same instant is 02:00 in Tokyo, well outside the same window.
  assert.equal(isOutsideWorkWindow(nineToFive, null, noonUtc, "Asia/Tokyo"), true);
});

test("an equal start and end means no window rather than a zero-length one", async () => {
  memberRow = { work_start_min: 540, work_end_min: 540 };
  assert.equal((await getEffectiveCaptureSettings("m1")).captureBlocked, false);
});

test("a day off blocks capture even inside the hours", async () => {
  const today = (new Date().getUTCDay() + 6) % 7;
  memberRow = { work_start_min: 0, work_end_min: 1439 };
  timeSettingsRow = { work_days: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today) };
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.captureBlocked, true);
  assert.equal(s.captureBlockReason, "outside_work_hours");

  timeSettingsRow = { work_days: [today] };
  assert.equal((await getEffectiveCaptureSettings("m1")).captureBlocked, false);
});

test("an empty work_days list does not read as every day being off", async () => {
  memberRow = {};
  timeSettingsRow = { work_days: [] };
  assert.equal((await getEffectiveCaptureSettings("m1")).captureBlocked, false);
});

test("a break outranks the schedule", async () => {
  const minute = minutesNowUtc();
  memberRow = {
    work_start_min: (minute + 10) % 1440,
    work_end_min: (minute + 20) % 1440,
    break_until: new Date(Date.now() + 10 * MINUTE),
    break_reason: "lunch",
  };
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.captureBlockReason, "break");
});
