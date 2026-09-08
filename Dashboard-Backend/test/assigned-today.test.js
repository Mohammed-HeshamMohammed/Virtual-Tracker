// T5 (PLAN-livesyncandagenttimer.md §11) - "Assigned today" is a formula
// re-evaluated on every read, not a persisted plan, so the rollover/overdue
// behavior lives entirely in computeAssignmentDueToday's arithmetic. This
// guards the identity the plan calls out explicitly: a 2h/day task with
// three working days elapsed and 2h worked owes 4h today, and the same task
// past its due date owes its whole outstanding remainder, not one day's
// share.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const HOUR = 3600;

/**
 * computeAssignedTodayDemand now runs two real, differently-shaped queries
 * (task_assignments and project_members, plus a budget/tracked-seconds
 * lookup per task-less project via timer-limit.service.js) against the same
 * mocked query() function. A single shared `rows` array can't answer all of
 * them correctly - it previously meant a "calling"-typed row meant for the
 * task_assignments test would also get picked up as a task-less project
 * membership, since nothing distinguished which query asked for it. Routing
 * by a keyword in the SQL text keeps each stubbed independently, the way
 * three separate tables actually behave.
 * @type {{
 *   rows: Record<string, unknown>[],
 *   taskLessMemberships: Record<string, unknown>[],
 *   budgetsByProject: Record<string, { type: string, scope: string, cost: number, include_non_billable_time?: boolean }>,
 *   trackedSecondsByProject: Record<string, number>,
 * }}
 */
const stub = { rows: [], taskLessMemberships: [], budgetsByProject: {}, trackedSecondsByProject: {} };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      if (sql.includes("FROM task_assignments")) return stub.rows;
      if (sql.includes("FROM project_members")) return stub.taskLessMemberships;
      if (sql.includes("FROM project_budgets")) {
        const projectId = params?.[0];
        const budget = stub.budgetsByProject[projectId];
        return budget ? [budget] : [];
      }
      if (sql.includes("FROM (")) {
        // getProjectTrackedSecondsPg's UNION ALL subquery - projectId is
        // params[0] (and again params[1], same value, one per branch).
        const projectId = params?.[0];
        return [{ total_seconds: stub.trackedSecondsByProject[projectId] ?? 0 }];
      }
      return [];
    },
    __closePostgresPoolForTests: async () => null,
    getPostgresPool: async () => null,
    isPostgresConfigured: () => true,
    probePostgresReadiness: async () => null,
    withTransaction: async () => null,
  },
});

const {
  computeAssignmentDueToday,
  computeAssignedTodayDemand,
  applyCapToAssignedTodayDemand,
} = await import("../src/modules/tasks/assigned-today.service.js");

// Monday - countWorkingDaysBetween counts weekdays inclusive, so picking a
// Monday start keeps the "N weekdays elapsed" arithmetic below unambiguous.
const START = "2024-01-01";

function scheduledRow(overrides = {}) {
  return {
    expected_seconds: null,
    worked_seconds: 0,
    project_type: "normal",
    start_date: START,
    due_date: null,
    duration_hours_per_day: 2,
    overtime_hours_per_day: 0,
    working_days: 20,
    duration_days: null,
    ...overrides,
  };
}

test("scheduled task: daily share x working days elapsed, minus worked, is due today", () => {
  // Mon Jan 1 -> Wed Jan 3 is 3 weekdays elapsed (inclusive).
  const row = scheduledRow({ worked_seconds: 2 * HOUR });
  const { due } = computeAssignmentDueToday(row, new Date("2024-01-03T12:00:00Z"));
  assert.equal(due, 4 * HOUR);
});

test("rollover: skipping a day grows the next day's due amount by one day's share", () => {
  const day1 = computeAssignmentDueToday(scheduledRow(), new Date("2024-01-01T12:00:00Z"));
  const day2 = computeAssignmentDueToday(scheduledRow(), new Date("2024-01-02T12:00:00Z"));
  const day3 = computeAssignmentDueToday(scheduledRow(), new Date("2024-01-03T12:00:00Z"));
  assert.equal(day1.due, 2 * HOUR);
  assert.equal(day2.due, 4 * HOUR);
  assert.equal(day3.due, 6 * HOUR);
});

test("overdue: elapsed saturates at the task's total working days, so the whole remainder falls due", () => {
  const row = scheduledRow({ worked_seconds: 2 * HOUR });
  // Two months past start - far beyond the 20 working days on this task.
  const { due } = computeAssignmentDueToday(row, new Date("2024-03-01T12:00:00Z"));
  const outstanding = 20 * 2 * HOUR - 2 * HOUR; // estimateAssignmentSeconds - worked
  assert.equal(due, outstanding);
});

test("no daily schedule: the whole outstanding remainder is due today", () => {
  const row = {
    expected_seconds: 10 * HOUR,
    worked_seconds: 3 * HOUR,
    project_type: "normal",
    start_date: START,
    duration_hours_per_day: 0,
    overtime_hours_per_day: 0,
  };
  const { due, rollover } = computeAssignmentDueToday(row);
  assert.equal(due, 7 * HOUR);
  assert.equal(rollover, 0);
});

test("calling project: the full outstanding amount is due today regardless of schedule fields", () => {
  const row = {
    expected_seconds: 3 * HOUR,
    worked_seconds: 0,
    project_type: "calling",
    duration_hours_per_day: 1,
    working_days: 1,
  };
  const { due } = computeAssignmentDueToday(row);
  assert.equal(due, 3 * HOUR);
});

test("multi-assignee: expected_seconds on the assignment row is honored over the task-level estimate", () => {
  // A 9h task split across three members: each assignment's own
  // expected_seconds is that member's 3h share, not the task's full 9h.
  const row = {
    expected_seconds: 3 * HOUR,
    worked_seconds: 0,
    project_type: "normal",
    duration_hours_per_day: 0,
  };
  const { due } = computeAssignmentDueToday(row);
  assert.equal(due, 3 * HOUR);
});

test("cap binding: demand above the member's daily cap defers the excess, nothing is dropped", () => {
  const demand = {
    demandSeconds: 9 * HOUR,
    rolloverSeconds: 0,
    taskCount: 2,
    byProjectType: { normal: 9 * HOUR, calling: 0 },
  };
  const result = applyCapToAssignedTodayDemand(demand, 6 * HOUR);
  assert.equal(result.demandSeconds, 9 * HOUR);
  assert.equal(result.plannedSeconds, 6 * HOUR);
  assert.equal(result.deferredSeconds, 3 * HOUR);
});

test("no cap (e.g. shift-based members): plannedSeconds equals demand, nothing deferred", () => {
  const demand = {
    demandSeconds: 5 * HOUR,
    rolloverSeconds: 0,
    taskCount: 1,
    byProjectType: { normal: 5 * HOUR, calling: 0 },
  };
  const result = applyCapToAssignedTodayDemand(demand, null);
  assert.equal(result.plannedSeconds, 5 * HOUR);
  assert.equal(result.deferredSeconds, 0);
});

test("computeAssignedTodayDemand sums due() across every open assignment and buckets by project type", async () => {
  stub.rows = [
    { expected_seconds: 1 * HOUR, worked_seconds: 0, project_type: "normal", duration_hours_per_day: 0 },
    { expected_seconds: 2 * HOUR, worked_seconds: 0, project_type: "calling", duration_hours_per_day: 0 },
  ];
  const result = await computeAssignedTodayDemand("member-1");
  assert.equal(result.demandSeconds, 3 * HOUR);
  assert.equal(result.taskCount, 2);
  assert.equal(result.byProjectType.normal, 1 * HOUR);
  assert.equal(result.byProjectType.calling, 2 * HOUR);
});

test("total: every open assignment counts, including ones nothing is due on today", async () => {
  stub.rows = [
    // Due today: no daily schedule, so the whole remainder falls due.
    { project_id: "p1", expected_seconds: 4 * HOUR, worked_seconds: 1 * HOUR, project_type: "normal", duration_hours_per_day: 0 },
    // Not due today at all - starts in the future - but still assigned.
    {
      project_id: "p2",
      expected_seconds: 6 * HOUR,
      worked_seconds: 0,
      project_type: "normal",
      start_date: "2999-01-01",
      duration_hours_per_day: 2,
      working_days: 3,
    },
    // Same project as the first row, and overrun: worked past the estimate.
    { project_id: "p1", expected_seconds: 2 * HOUR, worked_seconds: 3 * HOUR, project_type: "normal", duration_hours_per_day: 0 },
  ];
  const { total } = await computeAssignedTodayDemand("member-1");
  assert.equal(total.assignedSeconds, 12 * HOUR);
  assert.equal(total.workedSeconds, 4 * HOUR);
  // 3h left on the first, 6h on the second, and the overrun contributes 0 -
  // it must not eat another assignment's outstanding hours.
  assert.equal(total.remainingSeconds, 9 * HOUR);
  assert.equal(total.taskCount, 3);
  assert.equal(total.projectCount, 2);
});

test("total: task-less (calling/support) project memberships count too, not just task_assignments", async () => {
  stub.rows = [
    { project_id: "p1", expected_seconds: 4 * HOUR, worked_seconds: 1 * HOUR, project_type: "normal", duration_hours_per_day: 0 },
  ];
  stub.taskLessMemberships = [
    // Has a real per-person Hours-based budget: contributes hours.
    { project_id: "p-calling", project_type: "calling" },
    // No budget row at all (project_budgets has none for it): still a
    // membership - counts toward projectCount - but adds no hours, since
    // there is nothing to report a number against.
    { project_id: "p-support-nobudget", project_type: "support" },
    // Same project as the very first task_assignments row, reached via
    // membership too (shouldn't double the project into the count).
    { project_id: "p1", project_type: "calling" },
  ];
  stub.budgetsByProject = {
    "p-calling": { type: "Hours based", scope: "per_person", cost: 5 /* hours */ },
    // A per-project (shared) or Cost-based budget must not be treated as
    // this member's personal quota - loadPerPersonProjectBudgetTotals
    // already enforces that; this just confirms the wiring respects it.
    p1: { type: "Hours based", scope: "per_project", cost: 999 },
  };
  stub.trackedSecondsByProject = { "p-calling": 2 * HOUR };

  const { total } = await computeAssignedTodayDemand("member-1");

  // 4h from the task row + 5h from the calling project's per-person budget.
  assert.equal(total.assignedSeconds, 9 * HOUR);
  // 1h from the task row + 2h tracked against the calling project's budget.
  assert.equal(total.workedSeconds, 3 * HOUR);
  assert.equal(total.remainingSeconds, 3 * HOUR + 3 * HOUR);
  // task_assignments count is untouched by task-less memberships.
  assert.equal(total.taskCount, 1);
  // p1 (task_assignments) + p-calling + p-support-nobudget = 3 distinct
  // projects; p1 reached again via membership doesn't double-count.
  assert.equal(total.projectCount, 3);

  stub.taskLessMemberships = [];
  stub.budgetsByProject = {};
  stub.trackedSecondsByProject = {};
});
