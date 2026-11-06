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
    validateAssigneeWorkLimits: async () => null,
  },
});

mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: {
    sumDailyMemberActiveSeconds: async (_id, { fromDay, toDay }) =>
      fromDay === toDay ? stub.workedToday : stub.workedWeek,
    sumDailyMemberTaskActiveSeconds: async () => stub.workedTodayOnTask,
    // Only exercised for rolling_hour_cap tasks - none of these cases set
    // that flag, so this stub is never actually reached, just needs to
    // exist for the static import in timer-limit.service.js to resolve.
    sumDailyMemberTaskActiveSecondsRange: async () => stub.workedTodayOnTask,
    createPgSession: async () => null,
    fetchAllOpenPgSessions: async () => null,
    fetchLatestPgScreenshot: async () => null,
    fetchPgAppLogs: async () => null,
    fetchPgScreenshotById: async () => null,
    fetchPgScreenshots: async () => null,
    fetchPgSessionsForDashboard: async () => null,
    fetchPgUrlLogs: async () => null,
    findOpenPgSession: async () => null,
    findUnclassifiedAppsPg: async () => null,
    findUnclassifiedDomainsPg: async () => null,
    getPgSessionById: async () => null,
    insertActivityAppLog: async () => null,
    insertActivityScreenshot: async () => null,
    insertActivityUrlLog: async () => null,
    reassignPgActivityMemberId: async () => null,
    recordPgAlertSent: async () => null,
    sumAppLogSecondsByAppNamePg: async () => null,
    sumUrlLogSecondsByDomainPg: async () => null,
    updatePgSession: async () => null,
    wasPgAlertSentRecently: async () => null,
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
    computeProgressPercentage: async () => null,
    parseProgressUuid: async () => null,
    upsertTrackingRowPg: async () => null,
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
    listViewerProjectIdsPg: async () => [],
    listClientManagedProjectIdsPg: async () => new Set(),
    listClientTrackableProjectIdsPg: async () => new Set(),
    listMemberIdsForProjectsPg: async () => [],
    countMembersByProjectPg: async () => ({}),
    getProjectBudgetPg: async () => stub.projectBudget,
    getAllProjectBudgetsPg: async () => [],
    upsertProjectBudgetPg: async () => null,
    getProjectMemberLimitPg: async () => stub.projectMemberLimit ?? null,
    deleteProjectMemberLimitPg: async () => true,
    resolveMemberHourlyRatePg: async () => stub.memberHourlyRate ?? 0,
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
    getDailyActivityTotalsPg: async () => null,
    getMemberActivitySecondsPg: async () => null,
    getMemberWeeklyCapacityPg: async () => null,
    getProjectActivityMetricsPg: async () => null,
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
    taskTrackingRows: [],
    projectBudget: null,
    memberProjectSpentSeconds: 0,
  }, patch);
}

// The agent syncs the task's ALL-TIME figure for the member, and the day's allowance is what is
// left of today. Those are different numbers; each test below says which one it is moving.
test("a day with nothing left stops the timer", async () => {
  reset({ daily: 8, workedToday: 8 * HOUR });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 8 * HOUR, "sync");
  assert.equal(result.capped, true);
  assert.equal(result.activeSeconds, 8 * HOUR, "the figure is not rewritten down - the time was worked");
});

// PLAN D2 - the stop after midnight. Yesterday the member worked a full day on this task, so the
// all-time figure is already past one day's cap. Today's bucket is empty (it is a new day), so the
// timer must run; comparing the all-time figure with the daily cap stopped it on the first sync.
test("D2: a new day starts clean even when the task's all-time total is past one day's cap", async () => {
  reset({ daily: 8, workedToday: 0 });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 20 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 20 * HOUR);
});

test("D2: the same holds for the task's own daily hours", async () => {
  reset({ workedTodayOnTask: 0 });
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1", duration_hours_per_day: 8, duration_days: 5 }, // 40h estimate, 8h a day
    20 * HOUR,
    "sync",
  );
  assert.equal(result.capped, false);
});

test("D2: the task's daily hours still stop the timer once today's are used", async () => {
  reset({ workedTodayOnTask: 8 * HOUR });
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1", duration_hours_per_day: 8, duration_days: 5 },
    28 * HOUR,
    "sync",
  );
  assert.equal(result.capped, true);
});

test("a sync under the cap is not capped and passes through unchanged", async () => {
  reset({ daily: 8 });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 3 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 3 * HOUR);
});

test("a sync with an hour of the day left is not capped", async () => {
  reset({ daily: 8, workedToday: 7 * HOUR });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 8 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 8 * HOUR);
});

test("part of a day used leaves the timer running", async () => {
  reset({ daily: 8, workedToday: 6 * HOUR });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 5 * HOUR, "sync");
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 5 * HOUR);
});

test("a week with nothing left stops the timer", async () => {
  reset({ weekly: 40, workedWeek: 40 * HOUR });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1" }, 3 * HOUR, "sync");
  assert.equal(result.capped, true);
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

test("a shared_task_budget task caps against the whole team's pooled time, not just this member's own", async () => {
  // 4h total task estimate, teammate "member-2" already logged 3h - only 1h
  // of pool is left, independent of what member-1 has done so far.
  reset({ taskTrackingRows: [{ member_id: "member-2", active_seconds: 3 * HOUR }] });
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1", shared_task_budget: true, duration_hours_per_day: 4, duration_days: 1 },
    2 * HOUR, // member-1 alone is under the 4h total, but pooled with member-2's 3h it isn't
    "sync",
  );
  assert.equal(result.capped, true);
  assert.equal(result.activeSeconds, 1 * HOUR);
});

test("an unshared task ignores other assignees' time entirely (isolation, no regression)", async () => {
  // Same "member-2 has 3h" data as above, but shared_task_budget is unset -
  // the 4h estimate must stay this member's own private allotment.
  reset({ taskTrackingRows: [{ member_id: "member-2", active_seconds: 3 * HOUR }] });
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1", duration_hours_per_day: 4, duration_days: 1 },
    3.5 * HOUR,
    "sync",
  );
  assert.equal(result.capped, false);
  assert.equal(result.activeSeconds, 3.5 * HOUR);
});

test("a per-person project Hours budget with time left does not stop the timer", async () => {
  reset({
    projectBudget: { type: "Hours based", scope: "per_person", cost: 3, include_non_billable_time: true },
    memberProjectSpentSeconds: 2 * HOUR,
  });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1", project_id: "proj-1" }, 10 * HOUR, "sync");
  assert.equal(result.capped, false);
});

test("a per-person project Hours budget that is used up stops the timer", async () => {
  reset({
    projectBudget: { type: "Hours based", scope: "per_person", cost: 3, include_non_billable_time: true },
    memberProjectSpentSeconds: 3 * HOUR,
  });
  const result = await enforceTimerAllowanceOnSync({}, "member-1", { id: "task-1", project_id: "proj-1" }, 2 * HOUR, "sync");
  assert.equal(result.capped, true);
});

test("a shared (per_project) project budget does not affect per-member enforcement", async () => {
  // scope='per_project' is deliberately NOT folded into the per-member
  // remainder array (it stays a team-wide-only gate elsewhere) - a task on
  // a shared-budget project must sync through unaffected.
  reset({
    projectBudget: { type: "Hours based", scope: "per_project", cost: 3, include_non_billable_time: true },
    memberProjectSpentSeconds: 0,
  });
  const result = await enforceTimerAllowanceOnSync(
    {},
    "member-1",
    { id: "task-1", project_id: "proj-1" },
    100 * HOUR,
    "sync",
  );
  assert.equal(result.capped, false);
});
