// Guards the two "blocked" branches in recomputeTaskStatus. Task status is
// derived from assignment rows, but a task can also be blocked directly (board
// drag writes tasks.status, bypassing assignments) - the derivation must not
// silently revert that, and a blocked+todo mix must not read as in_progress
// when nobody has started. See LOGIC-REVIEW-tasks.md.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ task: Record<string, unknown>, assignments: Record<string, unknown>[], patched: Record<string, unknown> | null }} */
const stub = { task: {}, assignments: [], patched: null };

mock.module("../src/lib/postgres/tasks-postgres.service.js", {
  namedExports: {
    getTaskPg: async () => stub.task,
    updateTaskPg: async (_id, patch) => {
      stub.patched = patch;
      return { ...stub.task, ...patch };
    },
    listTasksPg: async () => [],
    createTaskPg: async () => null,
    deleteTaskPg: async () => null,
    getTasksByIdsPg: async () => null,
  },
});

mock.module("../src/lib/postgres/task-assignments-postgres.service.js", {
  namedExports: {
    getTaskAssignmentsPg: async () => stub.assignments,
    deleteAssignmentPg: async () => {},
    findAssignmentPg: async () => null,
    getAssignmentByIdPg: async () => null,
    getAssignmentsForTasksPg: async () => [],
    getTaskIdsAssignedToMembersPg: async () => [],
    listAllAssignmentsPg: async () => [],
    updateAssignmentPg: async () => ({}),
    upsertAssignmentPg: async () => ({}),
    sumActiveAssignmentSecondsPg: async () => 0,
    getInReviewAssignmentsForTaskPg: async () => [],
    hasAssignmentPg: async () => null,
  },
});

mock.module("../src/modules/tasks/task-time-tracking.js", {
  namedExports: { aggregateTaskProgress: async () => null,
    getManagementTaskTrackingRows: async () => null,
    getTaskTimeTracking: async () => null,
    reviewTaskTracking: async () => null,
    syncTaskTimeTracking: async () => null,
  },
});

const { recomputeTaskStatus } = await import("../src/modules/tasks/task-assignments.js");

function assignment(status) {
  return { id: `a-${status}-${Math.random()}`, task_id: "t1", member_id: "m1", status, required: true };
}

async function recompute({ taskStatus, assignmentStatuses }) {
  stub.task = { id: "t1", status: taskStatus };
  stub.assignments = assignmentStatuses.map(assignment);
  stub.patched = null;
  return recomputeTaskStatus({}, "t1");
}

test("blocked + todo mix reads as blocked, not in_progress - nobody started", async () => {
  const next = await recompute({ taskStatus: "todo", assignmentStatuses: ["blocked", "todo"] });
  assert.equal(next, "blocked");
});

test("a manually blocked task stays blocked when every assignee is still todo", async () => {
  const next = await recompute({ taskStatus: "blocked", assignmentStatuses: ["todo", "todo"] });
  assert.equal(next, "blocked");
});

test("an assignee actually starting overrides a manual block", async () => {
  const next = await recompute({ taskStatus: "blocked", assignmentStatuses: ["in_progress", "todo"] });
  assert.equal(next, "in_progress");
});

test("in_review overrides a manual block", async () => {
  const next = await recompute({ taskStatus: "blocked", assignmentStatuses: ["in_review", "todo"] });
  assert.equal(next, "in_review");
});

test("all done overrides a manual block", async () => {
  const next = await recompute({ taskStatus: "blocked", assignmentStatuses: ["done", "done"] });
  assert.equal(next, "done");
});

test("an unblocked all-todo task is unaffected", async () => {
  const next = await recompute({ taskStatus: "todo", assignmentStatuses: ["todo", "todo"] });
  assert.equal(next, "todo");
});
