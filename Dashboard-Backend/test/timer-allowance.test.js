// Guards the shared member daily/weekly cap used by both task timers and
// task-less "calling project" timers (project-type-selection-plan.md).
// The risk this covers: computeTimerAllowance was refactored to source its
// member-cap half from the same helper computeMemberTimerAllowance uses, so
// the two must stay in agreement and the task-only caps must NOT leak into
// the task-less path.
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
  namedExports: {
    computeTaskDailyHours: (task) => Number(task?.duration_hours_per_day ?? 0),
    computeEffectiveDailyCap: (taskHours, memberHours) => {
      const candidates = [taskHours, memberHours].filter((h) => h > 0);
      return candidates.length ? Math.min(...candidates) : 0;
    },
    getMemberLimitHours: async (_db, _id, period) => (period === "daily" ? stub.daily : stub.weekly),
    memberUsesShiftsForLimits: async () => stub.shifts,
    // Unused here, but task-assignments.js imports it from this module and a
    // module mock replaces the whole namespace.
    validateAssigneeWorkLimits: async () => null,
  },
});

mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: {
    sumDailyMemberActiveSeconds: async (_id, { fromDay, toDay }) =>
      fromDay === toDay ? stub.workedToday : stub.workedWeek,
    sumDailyMemberTaskActiveSeconds: async () => stub.workedTodayOnTask,
  },
});

const { computeMemberTimerAllowance, computeTimerAllowance } = await import(
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

test("member cap: daily limit remaining is what is left of today", async () => {
  reset({ daily: 8, workedToday: 6 * HOUR });
  const allowance = await computeMemberTimerAllowance({}, "member-1");
  assert.equal(allowance.allowedRemainingSeconds, 2 * HOUR);
  assert.equal(allowance.limitReached, false);
});

test("member cap: hitting the daily limit blocks the timer", async () => {
  reset({ daily: 8, workedToday: 8 * HOUR });
  const allowance = await computeMemberTimerAllowance({}, "member-1");
  assert.equal(allowance.allowedRemainingSeconds, 0);
  assert.equal(allowance.limitReached, true);
});

test("member cap: weekly limit only applies when no daily limit is set", async () => {
  reset({ weekly: 40, workedWeek: 39 * HOUR });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1")).allowedRemainingSeconds,
    1 * HOUR,
  );

  // With a daily limit present, the daily one governs and weekly is ignored -
  // preserving the pre-refactor behavior of computeTimerAllowance.
  reset({ daily: 8, weekly: 40, workedToday: 1 * HOUR, workedWeek: 39 * HOUR });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1")).allowedRemainingSeconds,
    7 * HOUR,
  );
});

test("member cap: no limits configured means no cap, not a zero cap", async () => {
  reset();
  const allowance = await computeMemberTimerAllowance({}, "member-1");
  assert.equal(allowance.allowedRemainingSeconds, null);
  assert.equal(allowance.limitReached, false);
});

test("member cap ignores task estimates entirely (the point of calling projects)", async () => {
  // Same member state; the task path caps on the 2h task estimate, the
  // task-less path does not - it only sees the member's own 8h day.
  reset({ daily: 8, workedToday: 1 * HOUR });
  const task = { id: "t1", duration_days: 1, duration_hours_per_day: 2 };

  const taskAllowance = await computeTimerAllowance({}, "member-1", task, {
    currentCumulativeActiveSeconds: 0,
  });
  const memberAllowance = await computeMemberTimerAllowance({}, "member-1", {
    currentCumulativeActiveSeconds: 0,
  });

  assert.equal(taskAllowance.allowedRemainingSeconds, 2 * HOUR);
  assert.equal(memberAllowance.allowedRemainingSeconds, 7 * HOUR);
});

test("task path still enforces the member daily cap when it is the tighter one", async () => {
  reset({ daily: 8, workedToday: 8 * HOUR });
  const task = { id: "t1", duration_days: 5, duration_hours_per_day: 8 };
  const allowance = await computeTimerAllowance({}, "member-1", task, {
    currentCumulativeActiveSeconds: 0,
  });
  assert.equal(allowance.limitReached, true);
});

test("shift-based members are uncapped on the task-less path", async () => {
  reset({ shifts: true, daily: 8, workedToday: 99 * HOUR });
  const allowance = await computeMemberTimerAllowance({}, "member-1");
  assert.equal(allowance.allowedRemainingSeconds, null);
  assert.equal(allowance.limitReached, false);
});
