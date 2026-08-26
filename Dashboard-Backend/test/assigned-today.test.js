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

/** @type {{ rows: Record<string, unknown>[] }} */
const stub = { rows: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async () => stub.rows,
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
