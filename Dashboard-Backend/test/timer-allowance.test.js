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
    projectMemberLimit: null,
    memberHourlyRate: 0,
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

// Weekly used to be ignored entirely whenever a daily cap was also set;
// 40499f7 ("combined weekly+daily work") made both apply, with the tighter
// one winning. This test asserted the old single-cap behavior and was never
// updated with that change, so it has been failing ever since.
test("member cap: daily and weekly both apply, whichever is tighter", async () => {
  // Weekly alone still governs when it is the only cap set.
  reset({ weekly: 40, workedWeek: 39 * HOUR });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1")).allowedRemainingSeconds,
    1 * HOUR,
  );

  // Both set, week is tighter: 7h left today but only 1h left this week.
  // Ignoring weekly here used to hand someone 7 more hours on the last day
  // of an almost-exhausted week.
  reset({ daily: 8, weekly: 40, workedToday: 1 * HOUR, workedWeek: 39 * HOUR });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1")).allowedRemainingSeconds,
    1 * HOUR,
  );

  // Both set, day is tighter: 2h left today against 10h left this week.
  reset({ daily: 8, weekly: 40, workedToday: 6 * HOUR, workedWeek: 30 * HOUR });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1")).allowedRemainingSeconds,
    2 * HOUR,
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

// ---------------------------------------------------------------------------
// Per-member project limits (project_member_limits - the "Members Limits" tab)
//
// These rows were written by the UI for a long time while nothing read them,
// so the risk here is twofold: that they go back to being inert, and that
// they REPLACE the member's own cap instead of tightening it. Every case
// below pins the tightening contract - the limit joins the same Math.min
// list, so whichever cap is smaller wins, and a limit that cannot be
// converted into time must not block tracking outright.
// ---------------------------------------------------------------------------

test("member limit: an hours limit caps what is left on the project", async () => {
  reset({
    projectMemberLimit: { cost: 10, type: "Hours limit", resets: "Never" },
    memberProjectSpentSeconds: 4 * HOUR,
  });
  const allowance = await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" });
  assert.equal(allowance.allowedRemainingSeconds, 6 * HOUR);
  assert.equal(allowance.limitReached, false);
});

test("member limit: exhausting it blocks the timer", async () => {
  reset({
    projectMemberLimit: { cost: 10, type: "Hours limit", resets: "Never" },
    memberProjectSpentSeconds: 10 * HOUR,
  });
  const allowance = await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" });
  assert.equal(allowance.allowedRemainingSeconds, 0);
  assert.equal(allowance.limitReached, true);
});

test("member limit tightens the personal cap, never loosens it", async () => {
  // Personal cap leaves 2h today; the project limit leaves 6h. The tighter
  // one (personal) must win - the project limit must not raise the ceiling.
  reset({
    daily: 8,
    workedToday: 6 * HOUR,
    projectMemberLimit: { cost: 10, type: "Hours limit", resets: "Never" },
    memberProjectSpentSeconds: 4 * HOUR,
  });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" })).allowedRemainingSeconds,
    2 * HOUR,
  );

  // Flip it: the project limit is now the tighter of the two and must win.
  reset({
    daily: 8,
    workedToday: 1 * HOUR,
    projectMemberLimit: { cost: 10, type: "Hours limit", resets: "Never" },
    memberProjectSpentSeconds: 9.5 * HOUR,
  });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" })).allowedRemainingSeconds,
    0.5 * HOUR,
  );
});

test("member limit: an amount limit converts through the member's rate", async () => {
  // $200 cap at $50/h = 4h of allowance, 1h of which is already spent.
  reset({
    projectMemberLimit: { cost: 200, type: "Total cost", based_on: "Pay rate", resets: "Never" },
    memberHourlyRate: 50,
    memberProjectSpentSeconds: 1 * HOUR,
  });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" })).allowedRemainingSeconds,
    3 * HOUR,
  );
});

test("member limit: an amount limit with no rate configured does not block tracking", async () => {
  // Nothing can convert $200 into time here. Blocking would make the project
  // untrackable because someone forgot to set a rate - it must read as "no
  // limit", not "zero limit".
  reset({
    projectMemberLimit: { cost: 200, type: "Total cost", based_on: "Pay rate", resets: "Never" },
    memberHourlyRate: 0,
    memberProjectSpentSeconds: 0,
  });
  const allowance = await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" });
  assert.equal(allowance.allowedRemainingSeconds, null);
  assert.equal(allowance.limitReached, false);
});

test("member limit: a zero/absent cap is not a limit", async () => {
  reset({ projectMemberLimit: { cost: 0, type: "Hours limit", resets: "Never" } });
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" })).allowedRemainingSeconds,
    null,
  );
});

test("member limit: one whose start date is still in the future is not enforced yet", async () => {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  reset({
    projectMemberLimit: {
      cost: 10,
      type: "Hours limit",
      resets: "Never",
      start_date: nextYear.toISOString().slice(0, 10),
    },
    memberProjectSpentSeconds: 100 * HOUR,
  });
  const allowance = await computeMemberTimerAllowance({}, "member-1", { projectId: "p1" });
  assert.equal(allowance.allowedRemainingSeconds, null);
  assert.equal(allowance.limitReached, false);
});

test("member limit: no project in play means it cannot apply", async () => {
  reset({
    projectMemberLimit: { cost: 10, type: "Hours limit", resets: "Never" },
    memberProjectSpentSeconds: 100 * HOUR,
  });
  // No projectId - a task-less timer with nothing to scope the limit to.
  assert.equal(
    (await computeMemberTimerAllowance({}, "member-1")).allowedRemainingSeconds,
    null,
  );
});

test("member limit also applies to task-anchored timers, not just task-less ones", async () => {
  reset({
    projectMemberLimit: { cost: 10, type: "Hours limit", resets: "Never" },
    memberProjectSpentSeconds: 9 * HOUR,
  });
  const task = { id: "t1", project_id: "p1", duration_hours: 40 };
  const allowance = await computeTimerAllowance({}, "member-1", task);
  assert.equal(allowance.allowedRemainingSeconds, 1 * HOUR);
});
