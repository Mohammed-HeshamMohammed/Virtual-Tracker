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

const {
  getEffectiveCaptureSettings,
  isOutsideWorkWindow,
  secondsUntilWindowChange,
  mayAccessMemberCaptureSettings,
} = await import(
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

// ---- when the answer next changes ------------------------------------------

test("the agent is told to re-ask at the minute a shift ends, not thirty minutes later", () => {
  const shift = { work_start_min: 9 * 60, work_end_min: 17 * 60 };
  const at = (h, m) => new Date(Date.UTC(2026, 0, 15, h, m));
  // 16:50 is inside the window, so the answer flips to "outside" at 17:00.
  assert.equal(secondsUntilWindowChange(shift, null, at(16, 50), "UTC", false), 10 * 60);
});

test("the agent is told to re-ask at the minute a shift starts", () => {
  const shift = { work_start_min: 9 * 60, work_end_min: 17 * 60 };
  const at = (h, m) => new Date(Date.UTC(2026, 0, 15, h, m));
  assert.equal(secondsUntilWindowChange(shift, null, at(8, 55), "UTC", true), 5 * 60);
});

test("with nothing changing soon the answer is capped at the agent's own poll interval", () => {
  const shift = { work_start_min: 9 * 60, work_end_min: 17 * 60 };
  const noon = new Date(Date.UTC(2026, 0, 15, 12, 0));
  assert.equal(secondsUntilWindowChange(shift, null, noon, "UTC", false), 30 * 60);
});

test("with no window configured there is never anything to re-ask about", () => {
  assert.equal(secondsUntilWindowChange({}, null, new Date(), "UTC", false), 30 * 60);
});

test("a day that starts as a day off flips when the next workday begins", () => {
  // 23:50 on a Thursday with Friday off... use Sunday->Monday: Monday is index 0.
  const monToFri = [0, 1, 2, 3, 4];
  const sundayLate = new Date(Date.UTC(2026, 0, 18, 23, 45)); // Sunday
  assert.equal(secondsUntilWindowChange({}, monToFri, sundayLate, "UTC", true), 15 * 60);
});

test("the schedule is reported on its own while a break is running", async () => {
  const minute = minutesNowUtc();
  memberRow = {
    work_start_min: (minute + 10) % 1440,
    work_end_min: (minute + 20) % 1440,
    break_until: new Date(Date.now() + 10 * MINUTE),
    break_reason: "lunch",
  };
  timeSettingsRow = {};
  const s = await getEffectiveCaptureSettings("m1");
  assert.equal(s.captureBlockReason, "break", "the break is what the member is shown");
  assert.equal(s.outsideWorkHours, true, "but the agent must still know the schedule blocks capture");
});

// ---- who may read or change a member's settings ------------------------------

const viewer = (memberId, roleName) => ({ memberId, roleName });

test("a member can read their own settings", () => {
  assert.equal(mayAccessMemberCaptureSettings(viewer("a", "Employee"), "a", null), true);
});

test("a member cannot read a colleague's settings, which carry their hours and break reason", () => {
  assert.equal(mayAccessMemberCaptureSettings(viewer("a", "Employee"), "b", null), false);
  assert.equal(mayAccessMemberCaptureSettings(viewer("a", "Team Lead"), "b", ["b"]), false, "not management");
});

test("a member cannot change their own settings; only the break is theirs", () => {
  assert.equal(mayAccessMemberCaptureSettings(viewer("a", "Employee"), "a", null, { write: true }), false);
});

test("management reaches someone inside their scope and no one outside it", () => {
  const manager = viewer("m", "Manager");
  assert.equal(mayAccessMemberCaptureSettings(manager, "b", ["b", "c"]), true);
  assert.equal(mayAccessMemberCaptureSettings(manager, "z", ["b", "c"]), false, "another branch");
  assert.equal(mayAccessMemberCaptureSettings(manager, "z", ["b", "c"], { write: true }), false);
});

test("a role that reaches everyone is not limited by a member list", () => {
  assert.equal(mayAccessMemberCaptureSettings(viewer("o", "Owner"), "anyone", null, { write: true }), true);
});

test("an empty reach list denies rather than allowing everyone", () => {
  assert.equal(mayAccessMemberCaptureSettings(viewer("m", "Manager"), "b", []), false);
});

test("a missing viewer or target is denied", () => {
  assert.equal(mayAccessMemberCaptureSettings(null, "b", null), false);
  assert.equal(mayAccessMemberCaptureSettings(viewer("m", "Owner"), "", null), false);
});
