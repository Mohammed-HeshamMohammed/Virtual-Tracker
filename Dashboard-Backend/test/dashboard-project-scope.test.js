// Guards the project scoping both dashboards use. It read project_members
// directly and returned "everything" only for the Owner, so a Super Admin,
// Admin or Super Manager - none of whom are normally rows in project_members -
// resolved to an empty set and got "No projects yet" on a fully populated org.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ memberProjects: string[], createdProjects: string[], clientProjects: string[] }} */
const stub = { memberProjects: [], createdProjects: [], clientProjects: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    // listViewerProjectIdsPg is one UNION over the three ways a viewer is
    // attached to a project, so the stub answers it as one result set.
    query: async (sql) => {
      if (sql.includes("FROM project_members") && sql.includes("FROM client_projects")) {
        return [
          ...stub.memberProjects,
          ...stub.createdProjects,
          ...stub.clientProjects,
        ].map((id) => ({ project_id: id }));
      }
      return [];
    },
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn({ query: async () => [] }),
    getPostgresPool: () => null,
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

const { getMemberProjectIds } = await import("../src/modules/dashboard/dashboard-utils.js");

function reset({ memberProjects = [], createdProjects = [], clientProjects = [] } = {}) {
  stub.memberProjects = memberProjects;
  stub.createdProjects = createdProjects;
  stub.clientProjects = clientProjects;
}

for (const role of ["Owner", "Super Admin", "Admin", "Super Manager"]) {
  test(`${role} sees every project, with no project_members row of their own`, async () => {
    reset();
    assert.equal(await getMemberProjectIds({}, "m1", role), null);
  });
}

test("an Employee is scoped to their own projects", async () => {
  reset({ memberProjects: ["p1", "p2"] });
  const ids = await getMemberProjectIds({}, "m1", "Employee");
  assert.deepEqual([...ids].sort(), ["p1", "p2"]);
});

test("a project the viewer created counts even without a membership row", async () => {
  reset({ memberProjects: ["p1"], createdProjects: ["p9"] });
  const ids = await getMemberProjectIds({}, "m1", "Employee");
  assert.deepEqual([...ids].sort(), ["p1", "p9"]);
});

test("an Employee on nothing gets an empty set, not everything", async () => {
  reset();
  const ids = await getMemberProjectIds({}, "m1", "Employee");
  assert.notEqual(ids, null);
  assert.equal(ids.size, 0);
});

test("a Client is scoped to the projects assigned to their client record", async () => {
  // A client member has no project_members row at all - they are attached
  // through clients.member_id -> client_projects. Resolving them to an empty
  // set is what left the Client role staring at empty pages everywhere.
  reset({ clientProjects: ["p4", "p5"] });
  const ids = await getMemberProjectIds({}, "m1", "Client");
  assert.deepEqual([...ids].sort(), ["p4", "p5"]);
});

test("a Client on no projects still gets an empty set, not everything", async () => {
  reset();
  const ids = await getMemberProjectIds({}, "m1", "Client");
  assert.notEqual(ids, null);
  assert.equal(ids.size, 0);
});
