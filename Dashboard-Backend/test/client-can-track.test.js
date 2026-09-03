// Guards the "client can clock in" feature: a project-level client_can_track
// flag lets a client member run a task-less timer on that specific project,
// independent of client_can_manage (task-editing rights) and independent of
// require_task_to_track (which still governs every other member unchanged).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ trackable: Set<string>, memberships: string[] }} */
const stub = { trackable: new Set(), memberships: [] };

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
    // mock.module replaces the whole namespace, so every export anything in
    // the transitive chain touches must exist - role-hierarchy.js reaches
    // lookup-availability.js, which needs isPostgresConfigured.
    getPostgresPool: () => null,
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn(),
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
    query: async (sql) => {
      // isProjectMemberForTimer/listTrackableProjectIdsPg's plain
      // project_members lookup for non-client roles - stub.memberships
      // stands in for whatever rows that query would return (all
      // client-role cases short-circuit before reaching this).
      void sql;
      return stub.memberships.map((project_id) => ({ project_id }));
    },
  },
});

const { clientMayTrackProject, isProjectMemberForTimer, listTrackableProjectIdsPg } = await import(
  "../src/http/project-access.js"
);

function reset() {
  stub.trackable = new Set();
  stub.memberships = [];
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

// listTrackableProjectIdsPg - same access rule as isProjectMemberForTimer,
// as a list. Backs the Project dropdown in "add manual time for someone".

test("listTrackableProjectIdsPg returns null (every project) for an org admin tier role", async () => {
  reset();
  assert.equal(await listTrackableProjectIdsPg("o1", "Owner"), null);
});

test("listTrackableProjectIdsPg for a client returns exactly their client_can_track projects", async () => {
  reset();
  stub.trackable = new Set(["p1", "p2"]);
  const ids = await listTrackableProjectIdsPg("c1", "Client");
  assert.deepEqual(new Set(ids), new Set(["p1", "p2"]));
});

test("listTrackableProjectIdsPg for a regular member returns their project_members rows", async () => {
  reset();
  stub.memberships = ["p3", "p4"];
  assert.deepEqual(await listTrackableProjectIdsPg("m1", "Employee"), ["p3", "p4"]);
});

test("listTrackableProjectIdsPg for a regular member with no project_members rows returns an empty list, not null", async () => {
  reset();
  const ids = await listTrackableProjectIdsPg("m1", "Employee");
  assert.deepEqual(ids, []);
  assert.notEqual(ids, null);
});

test("listTrackableProjectIdsPg with no memberId returns an empty list", async () => {
  reset();
  assert.deepEqual(await listTrackableProjectIdsPg("", "Employee"), []);
});
