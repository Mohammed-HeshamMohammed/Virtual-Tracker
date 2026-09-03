// Guards the "New Task Assigned" notification. It used to fire from the
// generic Firestore CRUD fallback in schema/routes.js on assigned_to changes,
// went dead when tasks migrated to Postgres (the Postgres branch never called
// it), and was deleted along with that fallback. It now lives in
// syncTaskAssignments - the one choke point every real assignment flows
// through - and fires per newly added assignee, not just the primary one.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ task: Record<string, unknown>, assignments: Record<string, unknown>[], notified: Record<string, unknown>[] }} */
const stub = { task: {}, assignments: [], notified: [] };

mock.module("../src/lib/postgres/tasks-postgres.service.js", {
  namedExports: {
    getTaskPg: async () => stub.task,
    updateTaskPg: async () => stub.task,
    listTasksPg: async () => [],
    createTaskPg: async () => null,
    deleteTaskPg: async () => null,
    getTasksByIdsPg: async () => null,
  },
});

mock.module("../src/lib/postgres/task-assignments-postgres.service.js", {
  namedExports: {
    getTaskAssignmentsPg: async () => stub.assignments,
    deleteAssignmentPg: async (id) => {
      stub.assignments = stub.assignments.filter((row) => row.id !== id);
    },
    upsertAssignmentPg: async (row) => {
      stub.assignments = [...stub.assignments, { id: `a-${row.member_id}`, ...row }];
      return row;
    },
    updateAssignmentPg: async () => ({}),
    findAssignmentPg: async () => null,
    getAssignmentByIdPg: async () => null,
    getAssignmentsForTasksPg: async () => [],
    getTaskIdsAssignedToMembersPg: async () => [],
    listAllAssignmentsPg: async () => [],
    sumActiveAssignmentSecondsPg: async () => 0,
    getInReviewAssignmentsForTaskPg: async () => [],
    hasAssignmentPg: async () => null,
  },
});

mock.module("../src/modules/notifications/service.js", {
  namedExports: {
    createNotification: async (_db, payload) => {
      stub.notified.push(payload);
      return "n1";
    },
    listNotificationsForMember: async () => [],
    markAllNotificationsAsRead: async () => null,
    markNotificationAsRead: async () => null,
  },
});

mock.module("../src/modules/tasks/task-workload-validation.js", {
  namedExports: { validateAssigneeWorkLimits: async () => null,
    computeEffectiveDailyCap: async () => null,
    getMemberLimitHours: async () => null,
    memberUsesShiftsForLimits: async () => null,
  },
});

mock.module("../src/modules/tasks/task-budget-validation.js", {
  namedExports: { assertTaskWithinProjectBudget: async () => null },
});

mock.module("../src/modules/tasks/task-time-tracking.js", {
  namedExports: { aggregateTaskProgress: async () => null,
    getManagementTaskTrackingRows: async () => null,
    getTaskTimeTracking: async () => null,
    reviewTaskTracking: async () => null,
    syncTaskTimeTracking: async () => null,
  },
});

const { syncTaskAssignments } = await import("../src/modules/tasks/task-assignments.js");

function reset(existingMemberIds = []) {
  stub.task = { id: "t1", title: "Ship the thing", status: "todo", project_id: "p1", assigned_to: existingMemberIds[0] ?? null };
  stub.assignments = existingMemberIds.map((memberId) => ({
    id: `a-${memberId}`,
    task_id: "t1",
    member_id: memberId,
    status: "todo",
    required: true,
  }));
  stub.notified = [];
}

test("a newly assigned member is notified", async () => {
  reset();
  await syncTaskAssignments({}, "t1", ["m1"]);
  assert.equal(stub.notified.length, 1);
  assert.equal(stub.notified[0].recipient_id, "m1");
  assert.equal(stub.notified[0].type, "task_assigned");
  assert.equal(stub.notified[0].title, "New Task Assigned");
  assert.match(String(stub.notified[0].message), /Ship the thing/);
  assert.equal(stub.notified[0].link, "pm-tasks?project=p1");
});

test("every newly added assignee is notified, not only the primary one", async () => {
  reset();
  await syncTaskAssignments({}, "t1", ["m1", "m2", "m3"]);
  assert.deepEqual(
    stub.notified.map((n) => n.recipient_id).sort(),
    ["m1", "m2", "m3"],
  );
});

test("re-syncing an unchanged roster notifies nobody", async () => {
  reset(["m1", "m2"]);
  await syncTaskAssignments({}, "t1", ["m1", "m2"]);
  assert.deepEqual(stub.notified, []);
});

test("adding one member to an existing roster notifies only that member", async () => {
  reset(["m1"]);
  await syncTaskAssignments({}, "t1", ["m1", "m2"], { removeUnlisted: true });
  assert.deepEqual(
    stub.notified.map((n) => n.recipient_id),
    ["m2"],
  );
});
