// Guards activityWeekPercent's source. It used to average screenshots' own
// per-capture activityLevel score (a moment-by-moment keystroke/mouse
// score) - a completely different quantity than "share of tracked time
// that was active". The agent's sidebar draws this percent as a ring with
// an active/idle-*hours* legend directly beneath it (WeeklyActivityCard),
// built from the very same weeklyActivity hours this function also
// returns - the two could disagree by construction (a handful of
// active-looking screenshots giving 63% while a week with almost no
// tracked sessions read 0s active / 0s idle right underneath it).
import test from "node:test";
import assert from "node:assert/strict";
import { buildViewPayload } from "../src/modules/dashboard/general-dashboard-service.js";
import { getRollingWeekDays, startOfDay } from "../src/modules/dashboard/dashboard-utils.js";

/** A timestamp guaranteed to fall inside the current rolling week, so the
 *  test never depends on which day "today" happens to be. */
function timeInWeek(dayIndex, offsetMs = 60_000) {
  const day = getRollingWeekDays()[dayIndex];
  return new Date(day.startMs + offsetMs).toISOString();
}

const BASE_ARGS = {
  memberIds: null,
  timeEntries: [],
  appLogs: [],
  tasks: [],
  projectRows: [],
  budgets: [],
  sessionIndex: new Map(),
  presenceByMember: new Map(),
  memberMeta: new Map(),
  projectNameById: new Map(),
  viewerMemberId: "m1",
};

test("activityWeekPercent is the active/(active+idle) ratio of real sessions, not a screenshot score", () => {
  const startedAt = timeInWeek(2);
  const payload = buildViewPayload({
    ...BASE_ARGS,
    sessions: [
      { memberId: "m1", started_at: startedAt, active_seconds: 3600, idle_seconds: 3600, task_id: null, project_id: "p1" },
    ],
    // A screenshot score that would give a wildly different answer (90%)
    // if it were still the source - proves it no longer is.
    screenshots: [{ memberId: "m1", capturedAt: startedAt, activityLevel: 90 }],
  });
  assert.equal(payload.stats.activityWeekPercent, 50, "1h active of 2h total tracked, not the 90% screenshot score");
});

test("a week with real screenshots but no tracked sessions reads 0%, not the screenshot average", () => {
  const startedAt = timeInWeek(2);
  const payload = buildViewPayload({
    ...BASE_ARGS,
    sessions: [],
    screenshots: [{ memberId: "m1", capturedAt: startedAt, activityLevel: 90 }],
  });
  assert.equal(payload.stats.activityWeekPercent, 0, "no tracked time this week - 0%, matching a 0s/0s legend");
});

test("a week with sessions but no screenshots still computes the ratio - it no longer needs screenshots at all", () => {
  const startedAt = timeInWeek(3);
  const payload = buildViewPayload({
    ...BASE_ARGS,
    sessions: [
      { memberId: "m1", started_at: startedAt, active_seconds: 2700, idle_seconds: 900, task_id: null, project_id: "p1" },
    ],
    screenshots: [],
  });
  // Derived from weeklyActivity's own per-day hours (0.75h -> 0.8h,
  // 0.25h -> 0.3h, each rounded to 1 decimal same as the legend displays),
  // not the raw seconds - so it's 0.8/(0.8+0.3) = 73%, not a raw 75%. This
  // is deliberate: it keeps the ring reading exactly what the hours legend
  // underneath it shows, instead of a more-precise figure the legend can't
  // back up.
  assert.equal(payload.stats.activityWeekPercent, 73, "matches rounded 0.8h/0.3h, not raw 2700s/900s");
});

test("activityTodayPercent is untouched - still the screenshot-level average, a separate metric", () => {
  // Built from startOfDay() itself, not a plain new Date() - todayKey
  // (inside buildViewPayload) is startOfDay().toISOString().slice(0, 10),
  // which is a local-midnight-converted-to-UTC instant. On a server whose
  // OS timezone isn't UTC that can land on a different UTC calendar date
  // than "right now" - a real, separate bug (flagged on its own), but not
  // one this test needs to fight: matching todayKey's own construction
  // keeps this deterministic regardless of the sandbox's timezone.
  const capturedAt = new Date(startOfDay().getTime() + 60_000).toISOString();
  const payload = buildViewPayload({
    ...BASE_ARGS,
    sessions: [],
    screenshots: [{ memberId: "m1", capturedAt, activityLevel: 90 }],
  });
  assert.equal(payload.stats.activityTodayPercent, 90, "today's figure still reads the screenshot score, unchanged");
});
