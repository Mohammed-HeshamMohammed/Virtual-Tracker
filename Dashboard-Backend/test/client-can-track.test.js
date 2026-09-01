// Guards the "client can clock in" feature: a project-level client_can_track
// flag lets a client member run a task-less timer on that specific project,
// independent of client_can_manage (task-editing rights) and independent of
// require_task_to_track (which still governs every other member unchanged).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ trackable: Set<string> }} */
const stub = { trackable: new Set() };

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectPg: async () => null,
    listClientManagedProjectIdsPg: async () => new Set(),
    listClientTrackableProjectIdsPg: async () => stub.trackable,
    listViewerProjectIdsPg: async () => [],
  },
});
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      // isProjectMemberForTimer's plain project_members lookup for non-client
      // roles - no rows means "not a member" for every case below that
      // reaches it (all client-role cases short-circuit before this).
      void sql;
      return [];
    },
  },
});

const { clientMayTrackProject, isProjectMemberForTimer } = await import("../src/http/project-access.js");

function reset() {
  stub.trackable = new Set();
}

test("clientMayTrackProject is false for a non-client role even if the project happens to be in the trackable set", async () => {
  reset();
  stub.trackable = new Set(["p1"]);
  const employee = { memberId: "m1", roleName: "Employee" };
  await assert.doesNotReject(async () => {
    assert.equal(await clientMayTrackProject(employee, "p1"), false);
  });
});

test("clientMayTrackProject is true only for a project actually flagged client_can_track for this client", async () => {
  reset();
  stub.trackable = new Set(["p1"]);
  const client = { memberId: "c1", roleName: "Client" };
  assert.equal(await clientMayTrackProject(client, "p1"), true);
  assert.equal(await clientMayTrackProject(client, "p2"), false, "a different project not in the trackable set");
});

test("clientMayTrackProject is false with no memberId or no projectId", async () => {
  reset();
  stub.trackable = new Set(["p1"]);
  assert.equal(await clientMayTrackProject({ memberId: "", roleName: "Client" }, "p1"), false);
  assert.equal(await clientMayTrackProject({ memberId: "c1", roleName: "Client" }, ""), false);
});

test("isProjectMemberForTimer delegates to clientMayTrackProject for the Client role", async () => {
  reset();
  stub.trackable = new Set(["p1"]);
  const client = { memberId: "c1", roleName: "Client" };
  assert.equal(await isProjectMemberForTimer(null, client, "p1"), true);
  assert.equal(await isProjectMemberForTimer(null, client, "p2"), false);
});

test("isProjectMemberForTimer still lets org admins through regardless of client_can_track", async () => {
  reset();
  const owner = { memberId: "o1", roleName: "Owner" };
  assert.equal(await isProjectMemberForTimer(null, owner, "any-project"), true);
});

test("isProjectMemberForTimer for a non-client, non-admin role falls through to the plain project_members check (empty here, so false)", async () => {
  reset();
  const employee = { memberId: "m1", roleName: "Employee" };
  assert.equal(await isProjectMemberForTimer(null, employee, "p1"), false);
});
