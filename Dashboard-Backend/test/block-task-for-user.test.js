// Guards blockTaskForUser (self-service "I'm blocked, waiting on X") and its
// interaction with recomputeTaskStatus: blocking one assignee on a task where
// someone else is still actively working must not flip the whole task to
// "blocked" - only the assignee-level state changes until nobody's left
// working. See LOGIC-REVIEW-tasks.md, "No way to block a single assignee".
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ task: Record<string, unknown>, assignment: Record<string, unknown>, assignments: Record<string, unknown>[], patchedAssignment: Record<string, unknown> | null, patchedTask: Record<string, unknown> | null }} */
const stub = { task: {}, assignment: {}, assignments: [], patchedAssignment: null, patchedTask: null, failNotifyLookup: false };

mock.module("../src/lib/postgres/tasks-postgres.service.js", {
  namedExports: {
    getTaskPg: async () => stub.task,
    updateTaskPg: async (_id, patch) => {
      stub.patchedTask = patch;
      return { ...stub.task, ...patch };
    },
    listTasksPg: async () => [],
  },
});

mock.module("../src/lib/postgres/task-assignments-postgres.service.js", {
  namedExports: {
    getTaskAssignmentsPg: async () => stub.assignments,
    deleteAssignmentPg: async () => {},
    findAssignmentPg: async () => stub.assignment,
    getAssignmentByIdPg: async (id) => stub.assignments.find((a) => a.id === id) ?? null,
    getAssignmentsForTasksPg: async () => [],
    getTaskIdsAssignedToMembersPg: async () => [],
    listAllAssignmentsPg: async () => [],
    updateAssignmentPg: async (id, patch) => {
      stub.patchedAssignment = patch;
      const existing = stub.assignments.find((a) => a.id === id);
      Object.assign(existing, patch);
      return existing;
    },
    upsertAssignmentPg: async (row) => row,
    getInReviewAssignmentsForTaskPg: async () => [],
    sumActiveAssignmentSecondsPg: async () => 0,
  },
});

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectPg: async () => null,
    listProjectMembersPg: async () => [],
    listProjectIdsForMemberPg: async () => [],
  },
});

// getDirectParentIds used to read the manager chain from Firestore, which the
// `fakeDb` stub below satisfied. It was since migrated to a direct
// `query(...)` against member_relationships, so these tests started reaching
// the real Postgres client and dying on "POSTGRES_URL is not configured" -
// nothing to do with what they actually assert. No relationships is the same
// empty-recipient case the Firestore stub produced.
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async () => {
      // The only thing reaching the raw client on this path is
      // getDirectParentIds, i.e. the notification recipient lookup.
      if (stub.failNotifyLookup) throw new Error("member_relationships unavailable");
      return [];
    },
    withTransaction: async (fn) => fn({ query: async () => [] }),
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

// Mocked directly (not just their Postgres deps) so their own transitive
// imports (relation-sync.js etc.) never load - notifyAssignmentStatusChange's
// recipient lookups (getDirectParentIds, getProjectLeadershipIds via these
// two) end up empty either way, so there's nothing left to notify.
mock.module("../src/modules/member-relationships/service.js", {
  namedExports: { getMemberAncestors: async () => [], getVisibleMemberIds: async () => [] },
});
mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: { resolveMemberRoleName: async () => "employee" },
});

mock.module("../src/modules/tasks/task-time-tracking.js", {
  namedExports: { aggregateTaskProgress: async () => null },
});

const { blockTaskForUser } = await import("../src/modules/tasks/task-assignments.js");

const fakeDb = {
  collection: () => ({
    where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
  }),
};

function setUp({ taskStatus, myStatus, coAssigneeStatus }) {
  const mine = { id: "a-mine", task_id: "t1", member_id: "m1", status: myStatus, required: true };
  const assignments = [mine];
  if (coAssigneeStatus) {
    assignments.push({ id: "a-co", task_id: "t1", member_id: "m2", status: coAssigneeStatus, required: true });
  }
  stub.task = { id: "t1", status: taskStatus, project_id: null };
  stub.assignment = mine;
  stub.assignments = assignments;
  stub.patchedAssignment = null;
  stub.patchedTask = null;
  stub.failNotifyLookup = false;
}

test("blocking myself from todo sets my assignment to blocked", async () => {
  setUp({ taskStatus: "todo", myStatus: "todo" });
  const result = await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });
  assert.equal(result.assignmentStatus, "blocked");
  assert.equal(stub.patchedAssignment?.status, "blocked");
});

test("blocking myself from in_progress sets my assignment to blocked", async () => {
  setUp({ taskStatus: "in_progress", myStatus: "in_progress" });
  const result = await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });
  assert.equal(result.assignmentStatus, "blocked");
});

test("sole assignee blocking themselves also blocks the task", async () => {
  setUp({ taskStatus: "todo", myStatus: "todo" });
  await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });
  assert.equal(stub.patchedTask?.status, "blocked");
});

test("blocking myself while a co-assignee is still working keeps the task in_progress", async () => {
  setUp({ taskStatus: "in_progress", myStatus: "in_progress", coAssigneeStatus: "in_progress" });
  await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });
  // recomputeTaskStatus checks "some in_progress" before "some blocked" -
  // one person blocked doesn't stall a task others are actively on.
  assert.equal(stub.patchedTask?.status, "in_progress");
});

test("already blocked is a no-op, not a re-block", async () => {
  setUp({ taskStatus: "blocked", myStatus: "blocked" });
  const result = await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });
  assert.equal(result.statusChanged, false);
  assert.equal(stub.patchedAssignment, null);
});

test("a done assignment cannot be blocked", async () => {
  setUp({ taskStatus: "done", myStatus: "done" });
  const result = await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });
  assert.equal(result.assignmentStatus, "done");
  assert.equal(stub.patchedAssignment, null);
});

// The status change is persisted BEFORE the notification is sent, and
// recomputeTaskStatus runs after it. When the notify path was allowed to
// throw, a hiccup in the recipient lookup skipped that recompute and made an
// already-applied block report as failed - so the caller would retry
// something that had already happened. Notification is best-effort now.
test("a failing notification does not undo or fail the block", async () => {
  setUp({ taskStatus: "todo", myStatus: "todo" });
  stub.failNotifyLookup = true;

  const result = await blockTaskForUser(fakeDb, { taskId: "t1", userId: "m1", userName: "Me" });

  assert.equal(result.assignmentStatus, "blocked");
  assert.equal(stub.patchedAssignment?.status, "blocked");
  // Proves the post-notification work still ran rather than being skipped.
  assert.equal(stub.patchedTask?.status, "blocked");
});
