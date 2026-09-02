// Guards viewerCanCreateProjectTasks's restrict_task_creation branch.
//
// The project modal has a real toggle for this - "Only managers can create
// tasks", off = "any assigned member of this project add tasks to it" - but
// this function (the actual gate behind POST /api/tasks, and the source of
// ProjectInfo.can_create_tasks / the "+ New task" button in both the agent
// and Dashboard-Web) never read the flag: turning it off had no effect,
// since a non-manager member's create call still 403'd right after the
// button that Dashboard-Web's own permission mirror (canCreateTasksInProject)
// had already shown them.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ members: Array<{project_role: string}>, project: any }} */
const stub = { members: [], project: null };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async () => stub.members,
  },
});
mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectPg: async () => stub.project,
    listClientManagedProjectIdsPg: async () => new Set(),
    listClientTrackableProjectIdsPg: async () => new Set(),
    listViewerProjectIdsPg: async () => [],
  },
});

const { viewerCanCreateProjectTasks } = await import("../src/http/project-access.js");

function reset() {
  stub.members = [];
  stub.project = null;
}

const EMPLOYEE = { memberId: "m1", roleName: "Employee" };

test("a non-manager project member is refused when restrict_task_creation is on (the default)", async () => {
  reset();
  stub.members = [{ project_role: "member" }];
  stub.project = { id: "p1", restrict_task_creation: true };
  assert.equal(await viewerCanCreateProjectTasks(null, EMPLOYEE, "p1"), false);
});

test("a non-manager project member IS allowed once restrict_task_creation is off", async () => {
  reset();
  stub.members = [{ project_role: "member" }];
  stub.project = { id: "p1", restrict_task_creation: false };
  assert.equal(await viewerCanCreateProjectTasks(null, EMPLOYEE, "p1"), true);
});

test("restrict_task_creation off still refuses someone with no project_members row at all", async () => {
  reset();
  stub.members = [];
  stub.project = { id: "p1", restrict_task_creation: false };
  assert.equal(await viewerCanCreateProjectTasks(null, EMPLOYEE, "p1"), false);
});

test("a project manager is unaffected by the flag either way", async () => {
  reset();
  stub.members = [{ project_role: "manager" }];
  for (const restrict of [true, false]) {
    stub.project = { id: "p1", restrict_task_creation: restrict };
    assert.equal(await viewerCanCreateProjectTasks(null, EMPLOYEE, "p1"), true, `restrict=${restrict}`);
  }
});

test("an org admin tier role never needs the flag or a project_members row at all", async () => {
  reset();
  stub.project = { id: "p1", restrict_task_creation: true };
  assert.equal(await viewerCanCreateProjectTasks(null, { memberId: "m9", roleName: "Owner" }, "p1"), true);
});
