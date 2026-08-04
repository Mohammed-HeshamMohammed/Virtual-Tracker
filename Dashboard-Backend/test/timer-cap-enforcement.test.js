// Guards TC-5: enforceTimerAllowanceOnSync must actually be able to cap a
// sync. Before this fix, the ceiling it compared `activeSeconds` against was
// *derived from* `activeSeconds` itself (maxCumulativeActiveSeconds =
// currentCumulativeActiveSeconds + allowedRemainingSeconds, computed with
// currentCumulativeActiveSeconds = activeSeconds), which made
// `activeSeconds > maxCumulativeActiveSeconds` reduce to `0 >
// allowedRemainingSeconds` - never true, since every remainder is clamped at
// 0. `capped` was always false, so a session that started under a cap could
// run past it indefinitely.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const HOUR = 3600;

/** @type {{ daily: number, weekly: number, shifts: boolean, workedToday: number, workedWeek: number, workedTodayOnTask: number }} */
const stub = {
  daily: 0,
  weekly: 0,
  shifts: false,
  workedToday: 0,
  workedWeek: 0,
  workedTodayOnTask: 0,
};

mock.module("../src/modules/tasks/task-workload-validation.js", {
  exports: {
    computeTaskDailyHours: (task) => Number(task?.duration_hours_per_day ?? 0),
    computeEffectiveDailyCap: (taskHours, memberHours) => {
      const candidates = [taskHours, memberHours].filter((h) => h > 0);
      return candidates.length ? Math.min(...candidates) : 0;
    },
    getMemberLimitHours: async (_db, _id, period) => (period === "daily" ? stub.daily : stub.weekly),
    memberUsesShiftsForLimits: async () => stub.shifts,
    validateAssigneeWorkLimits: async () => null,
  },
});

mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  exports: {
    sumDailyMemberActiveSeconds: async (_id, { fromDay, toDay }) =>
      fromDay === toDay ? stub.workedToday : stub.workedWeek,
    sumDailyMemberTaskActiveSeconds: async () => stub.workedTodayOnTask,
  },
});

const { enforceTimerAllowanceOnSync } = await import(
  "../src/modules/tasks/timer-limit.service.js"
);

function reset(patch = {}) {
  Object.assign(stub, {
    daily: 0,
    weekly: 0,
    shifts: false,
    workedToday: 0,
    workedWeek: 0,
    workedTodayOnTask: 0,
  }, patch);
}

test("a sync above the member's daily cap returns capped: true", async () => {
  // This exact assertion is the one the plan calls out as failing today.
  reset({ daily: 8 }); // 8h daily cap, nothing worked yet in the stub context
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1" },
    9 * HOUR, // syncing in 9h against an 8h cap
    "sync",
  );
  assert.equal(result.capped, true);
  assert.equal(result.activeSeconds, 8 * HOUR);
});

test("a sync under the cap is not capped and passes through unchanged", async () => {
  reset({ daily: 8 });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 3 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 3 * HOUR);
});

test("a sync exactly at the cap is not capped (boundary is inclusive of the limit)", async () => {
  reset({ daily: 8 });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 8 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 8 * HOUR);
});

test("the ceiling accounts for time already worked today outside this sync value", async () => {
  // 8h daily cap, 6h already worked today (per the stub's workedTodaySeconds) -
  // only 2h of ceiling remains, independent of what this sync reports.
  reset({ daily: 8, workedToday: 6 * HOUR });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 5 * HOUR, "sync");
  assert.equal(result.capped, true);
  assert.equal(result.activeSeconds, 2 * HOUR);
});

test("no configured limits means no cap, sync passes through at any value", async () => {
  reset();
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 100 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 100 * HOUR);
});

test("a task total-hours ceiling caps a sync independent of the value being checked", async () => {
  reset();
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1", duration_hours_per_day: 4, duration_days: 1 }, // 4h total task estimate
    6 * HOUR,
    "sync",
  );
  assert.equal(result.capped, true);
  assert.equal(result.activeSeconds, 4 * HOUR);
});

test("shift-based members are uncapped on sync, same as on start", async () => {
  reset({ shifts: true });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 999 * HOUR, "sync");
  assert.equal(result.capped, false);
});

test("start/resume still throw when the day's rollup has already reached the cap (unchanged behavior)", async () => {
  // limitReached for start/resume is driven by workedTodaySeconds (the DB
  // rollup), not by the activeSeconds value being synced in - this must keep
  // working exactly as it did before the TC-5 ceiling fix.
  reset({ daily: 8, workedToday: 8 * HOUR });
  await assert.rejects(
    () => enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 0, "start"),
    /TIMER_LIMIT_REACHED|Maximum allowed work time/,
  );
});
