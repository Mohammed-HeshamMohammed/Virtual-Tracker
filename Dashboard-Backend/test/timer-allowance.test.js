// Guards the shared member daily/weekly cap used by both task timers and
// task-less "calling project" timers (project-type-selection-plan.md).
// The risk this covers: computeTimerAllowance was refactored to source its
// member-cap half from the same helper computeMemberTimerAllowance uses, so
// the two must stay in agreement and the task-only caps must NOT leak into
// the task-less path.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const HOUR = 3600;

/** @type {{ daily: number, weekly: number, shifts: boolean, workedToday: number, workedWeek: number, workedTodayOnTask: number, taskTrackingRows: Array<{member_id: string, active_seconds: number}>, projectBudget: object | null, memberProjectSpentSeconds: number }} */
const stub = {
  daily: 0,
  weekly: 0,
  shifts: false,
  workedToday: 0,
  workedWeek: 0,
  workedTodayOnTask: 0,
  taskTrackingRows: [],
  projectBudget: null,
  memberProjectSpentSeconds: 0,
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
    sumDailyMemberActiveSeconds: async () => {
      // First call in loadMemberCapContext is for workedToday, second call is for workedWeek
      const val = stub._callToggle ? stub.workedWeek : stub.workedToday;
      stub._callToggle = !stub._callToggle;
      return val;
    },
    sumDailyMemberTaskActiveSeconds: async () => stub.workedTodayOnTask,
    // Only exercised for rolling_hour_cap tasks - none of these cases set
    // that flag, so this stub is never actually reached, just needs to
    // exist for the static import in timer-limit.service.js to resolve.
    sumDailyMemberTaskActiveSecondsRange: async () => stub.workedTodayOnTask,
  },
});

// timer-limit.service.js now imports getTrackingRowPg/getTaskTrackingRowsPg
// directly (shared_task_budget's sum-across-assignees seam), and
// task-assignments.js (imported transitively via estimateAssignmentSeconds)
// needs getAllTrackingRowsPg/updateTrackingFieldsPg to resolve - mock.module
// replaces the whole namespace, so all four must be present even though only
// the first two are ever actually exercised by these tests.
mock.module("../src/lib/postgres/task-member-progress.service.js", {
  namedExports: {
    getTrackingRowPg: async () => null,
    getTaskTrackingRowsPg: async () => stub.taskTrackingRows,
    getAllTrackingRowsPg: async () => [],
    updateTrackingFieldsPg: async () => null,
  },
});

// projects-postgres.service.js has a wide transitive fan-in (task-assignments.js
// directly, plus activity-scope.js and members/relation-sync.js pulled in
// through it) - mock.module replaces the whole namespace, so every export
// anything in that chain touches must exist here even though only
// getProjectBudgetPg/getProjectTrackedSecondsPg are ever meaningfully
// exercised by these tests.
mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    createProjectPg: async () => null,
    getProjectPg: async () => null,
    updateProjectPg: async () => null,
    archiveProjectPg: async () => null,
    deleteProjectPg: async () => null,
    listProjectsPg: async () => [],
    addProjectMemberPg: async () => null,
    removeProjectMemberPg: async () => null,
    listProjectMembersPg: async () => [],
    listProjectIdsForMemberPg: async () => [],
    listMemberIdsForProjectsPg: async () => [],
    countMembersByProjectPg: async () => ({}),
    getProjectBudgetPg: async () => stub.projectBudget,
    getAllProjectBudgetsPg: async () => [],
    upsertProjectBudgetPg: async () => null,
    getProjectMemberLimitPg: async () => null,
    listProjectMemberLimitsPg: async () => [],
    getAllProjectMemberLimitsPg: async () => [],
    upsertProjectMemberLimitPg: async () => null,
    linkClientProjectPg: async () => null,
    unlinkClientProjectPg: async () => null,
    listClientIdsForProjectPg: async () => [],
    listProjectIdsForClientPg: async () => [],
    linkTeamProjectPg: async () => null,
    unlinkTeamProjectPg: async () => null,
    deleteTeamProjectsForTeamPg: async () => null,
    listTeamIdsForProjectPg: async () => [],
    listProjectIdsForTeamPg: async () => [],
    getProjectTrackedSecondsPg: async () => stub.memberProjectSpentSeconds,
    computeProjectSpentCostPg: async () => 0,
    computeProjectSpentPg: async () => 0,
    computeProjectSpentForAllPg: async () => new Map(),
    computeProjectBudgetTargetForAllPg: async () => new Map(),
    computeProjectBudgetTargetPg: async () => 0,
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
    taskTrackingRows: [],
    projectBudget: null,
    memberProjectSpentSeconds: 0,
    _callToggle: false,
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

test("a calling-project session picks up the project's per-person budget when it's the tighter limit", async () => {
  // 8h personal daily cap, nothing worked yet - but the project's own
  // per-person Hours budget (2h, 1h already spent) is tighter and should win.
  reset({
    daily: 8,
    projectBudget: { type: "Hours based", scope: "per_person", cost: 2, include_non_billable_time: true },
    memberProjectSpentSeconds: 1 * HOUR,
  });
  const allowance = await computeMemberTimerAllowance({}, "member-1", { projectId: "proj-1" });
  assert.equal(allowance.allowedRemainingSeconds, 1 * HOUR);
  assert.equal(allowance.limitReached, false);
});

test("no projectId means the project-budget seam is a no-op (unchanged behavior)", async () => {
  reset({ daily: 8, projectBudget: { type: "Hours based", scope: "per_person", cost: 1 } });
  const allowance = await computeMemberTimerAllowance({}, "member-1");
  assert.equal(allowance.allowedRemainingSeconds, 8 * HOUR);
});

test("a shared_task_budget task pools estimatedSeconds across every assignee for computeTimerAllowance too", async () => {
  reset({ taskTrackingRows: [{ member_id: "member-2", active_seconds: 5 * HOUR }] });
  const task = { id: "t1", shared_task_budget: true, duration_hours_per_day: 8, duration_days: 1 };
  const allowance = await computeTimerAllowance({}, "member-1", task, {
    currentCumulativeActiveSeconds: 0,
  });
  // 8h total, 5h already used by member-2, 3h left for the pool regardless
  // of member-1's own (zero) contribution so far.
  assert.equal(allowance.allowedRemainingSeconds, 3 * HOUR);
});
