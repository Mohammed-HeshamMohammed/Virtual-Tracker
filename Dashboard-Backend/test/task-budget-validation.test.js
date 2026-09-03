// Guards assertTaskWithinProjectBudget - holds a task's own committed hours
// (or cost, priced off its assignees' rates) to the project's own budget,
// checked whenever a task's assignees are synced (create or edit, from the
// task wizard). per_person-scoped budgets are left to the existing live
// timer-allowance enforcement; this is specifically the per_project total,
// which nothing else checked at task-save time before.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{
 *   budget: any,
 *   otherTasks: any[],
 *   assignmentsByTask: Record<string, {member_id: string}[]>,
 *   rates: Record<string, number>,
 * }} */
const stub = { budget: null, otherTasks: [], assignmentsByTask: {}, rates: {} };

function reset() {
  stub.budget = null;
  stub.otherTasks = [];
  stub.assignmentsByTask = {};
  stub.rates = {};
}

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectBudgetPg: async () => stub.budget,
    resolveMemberHourlyRatePg: async (_db, _projectId, memberId) => stub.rates[memberId] ?? 0,
    // Everything else on this module is unreachable through
    // assertTaskWithinProjectBudget's own call graph - stubbed only so
    // mock.module's whole-namespace replacement doesn't leave a caller
    // elsewhere in the transitive import chain without an export.
    addProjectMemberPg: async () => null,
    archiveProjectPg: async () => null,
    computeProjectBudgetTargetForAllPg: async () => null,
    computeProjectBudgetTargetPg: async () => null,
    computeProjectSpentCostPg: async () => null,
    computeProjectSpentForAllPg: async () => null,
    computeProjectSpentPg: async () => null,
    countMembersByProjectPg: async () => null,
    createProjectPg: async () => null,
    deleteProjectMemberLimitPg: async () => null,
    deleteProjectPg: async () => null,
    deleteTeamProjectsForTeamPg: async () => null,
    getAllProjectBudgetsPg: async () => [],
    getAllProjectMemberLimitsPg: async () => [],
    getDailyActivityTotalsPg: async () => null,
    getMemberActivitySecondsPg: async () => null,
    getMemberDailyActivityTotalsPg: async () => null,
    getMemberProjectActivityMetricsPg: async () => null,
    getMemberWeeklyCapacityPg: async () => null,
    getProjectActivityMetricsPg: async () => null,
    getProjectMemberLimitPg: async () => null,
    getProjectPg: async () => null,
    getProjectTrackedSecondsPg: async () => null,
    linkClientProjectPg: async () => null,
    linkTeamProjectPg: async () => null,
    listClientIdsForProjectPg: async () => [],
    listClientManagedProjectIdsPg: async () => new Set(),
    listClientTrackableProjectIdsPg: async () => new Set(),
    listMemberIdsForProjectsPg: async () => [],
    listProjectIdsForClientPg: async () => [],
    listProjectIdsForMemberPg: async () => [],
    listProjectIdsForTeamPg: async () => [],
    listProjectMemberLimitsPg: async () => [],
    listProjectMembersPg: async () => [],
    listProjectsPg: async () => [],
    listTeamIdsForProjectPg: async () => [],
    listViewerProjectIdsPg: async () => [],
    removeProjectMemberPg: async () => null,
    toDayStrOrNull: () => null,
    unlinkClientProjectPg: async () => null,
    unlinkTeamProjectPg: async () => null,
    updateProjectPg: async () => null,
    upsertProjectBudgetPg: async () => null,
    upsertProjectMemberLimitPg: async () => null,
  },
});

mock.module("../src/lib/postgres/tasks-postgres.service.js", {
  namedExports: {
    listTasksPg: async () => stub.otherTasks,
    createTaskPg: async () => null,
    deleteTaskPg: async () => null,
    getTaskPg: async () => null,
    getTasksByIdsPg: async () => [],
    updateTaskPg: async () => null,
  },
});

mock.module("../src/lib/postgres/task-assignments-postgres.service.js", {
  namedExports: {
    getTaskAssignmentsPg: async (taskId) => stub.assignmentsByTask[taskId] ?? [],
    deleteAssignmentPg: async () => null,
    findAssignmentPg: async () => null,
    getAssignmentByIdPg: async () => null,
    getAssignmentsForTasksPg: async () => [],
    getInReviewAssignmentsForTaskPg: async () => [],
    getTaskIdsAssignedToMembersPg: async () => new Set(),
    hasAssignmentPg: async () => false,
    listAllAssignmentsPg: async () => [],
    sumActiveAssignmentSecondsPg: async () => 0,
    updateAssignmentPg: async () => null,
    upsertAssignmentPg: async () => null,
  },
});

mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: {
    buildMemberMetaMap: async (_db, ids) =>
      new Map(ids.map((id) => [id, { name: `Member ${id}`, initials: "??", avatarUrl: null }])),
    getProjectScopedMemberIds: async () => [],
    memberOptionsFromMeta: () => [],
    resolveActivityFeedScope: async () => null,
    resolveMemberRoleName: async () => "Employee",
  },
});

const { assertTaskWithinProjectBudget } = await import("../src/modules/tasks/task-budget-validation.js");

function hoursTask(id, hoursPerDay, days = 1) {
  return { id, duration_hours_per_day: hoursPerDay, duration_days: days };
}

test("no budget at all - never throws regardless of hours", async () => {
  reset();
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 999),
      assigneeIds: ["m1"],
    }),
  );
});

test("per_person-scoped budget is left alone - that's the live timer-allowance system's job", async () => {
  reset();
  stub.budget = { type: "Hours based", scope: "per_person", cost: 1 };
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 999),
      assigneeIds: ["m1"],
    }),
  );
});

test("Hours based: a task within the remaining budget passes", async () => {
  reset();
  stub.budget = { type: "Hours based", scope: "per_project", cost: 100 };
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 8, 5), // 40h
      assigneeIds: ["m1"],
    }),
  );
});

test("Hours based: this task plus every other task's own committed hours over the cap is rejected", async () => {
  reset();
  stub.budget = { type: "Hours based", scope: "per_project", cost: 50 };
  stub.otherTasks = [hoursTask("t2", 8, 5)]; // 40h already committed elsewhere
  await assert.rejects(
    () =>
      assertTaskWithinProjectBudget(null, {
        projectId: "p1",
        taskId: "t1",
        taskDraft: hoursTask("t1", 4, 5), // +20h -> 60h total, over the 50h cap
        assigneeIds: ["m1"],
      }),
    /60h.*10h over its 50h budget/,
  );
});

test("Hours based: the task being edited is excluded from its own 'other tasks' total, not double-counted", async () => {
  reset();
  stub.budget = { type: "Hours based", scope: "per_project", cost: 40 };
  stub.otherTasks = [hoursTask("t1", 8, 5)]; // this IS the task being saved, listed among all project tasks
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 8, 5), // same 40h, would double to 80h if not excluded
      assigneeIds: ["m1"],
    }),
  );
});

test("a task with no hours set at all commits nothing and is never checked", async () => {
  reset();
  stub.budget = { type: "Hours based", scope: "per_project", cost: 1 };
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 0),
      assigneeIds: ["m1"],
    }),
  );
});

test("a task with hours but nobody assigned yet commits nothing", async () => {
  reset();
  stub.budget = { type: "Hours based", scope: "per_project", cost: 1 };
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 999),
      assigneeIds: [],
    }),
  );
});

test("Cost based, pay rate: an assignee with no rate set is rejected by name, before any budget math even runs", async () => {
  reset();
  stub.budget = { type: "Cost based", based_on: "Pay rate", scope: "per_project", cost: 1000 };
  stub.rates = { m1: 0 };
  await assert.rejects(
    () =>
      assertTaskWithinProjectBudget(null, {
        projectId: "p1",
        taskId: "t1",
        taskDraft: hoursTask("t1", 8, 5),
        assigneeIds: ["m1"],
      }),
    /Set an hourly pay rate for Member m1/,
  );
});

test("Cost based, pay rate: a task priced within the cap passes", async () => {
  reset();
  stub.budget = { type: "Cost based", based_on: "Pay rate", scope: "per_project", cost: 1000 };
  stub.rates = { m1: 20 };
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 8, 5), // 40h * $20 = $800, under the $1000 cap
      assigneeIds: ["m1"],
    }),
  );
});

test("Cost based, pay rate: this task's cost plus other tasks' own priced cost over the cap is rejected", async () => {
  reset();
  stub.budget = { type: "Cost based", based_on: "Pay rate", scope: "per_project", cost: 500 };
  stub.rates = { m1: 20, m2: 10 };
  stub.otherTasks = [hoursTask("t2", 8, 5)]; // 40h
  stub.assignmentsByTask = { t2: [{ member_id: "m2" }] }; // 40h * $10 = $400 already committed
  await assert.rejects(
    () =>
      assertTaskWithinProjectBudget(null, {
        projectId: "p1",
        taskId: "t1",
        taskDraft: hoursTask("t1", 8, 5), // 40h * $20 = $800 -> $1200 total, over the $500 cap
        assigneeIds: ["m1"],
      }),
    /\$1200.*\$700 over its \$500 budget/,
  );
});

test("Cost based, bill rate: no per-assignee pay-rate gate - bill rate prices off the client, not the member", async () => {
  reset();
  stub.budget = { type: "Cost based", based_on: "Bill rate", scope: "per_project", cost: 10 };
  stub.rates = {}; // no member rates configured anywhere
  await assert.doesNotReject(() =>
    assertTaskWithinProjectBudget(null, {
      projectId: "p1",
      taskId: "t1",
      taskDraft: hoursTask("t1", 0), // 0 hours -> nothing to price, passes regardless of the cap
      assigneeIds: ["m1"],
    }),
  );
});
