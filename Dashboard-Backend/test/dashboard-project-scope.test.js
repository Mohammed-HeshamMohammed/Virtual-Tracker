// Guards the project scoping both dashboards use. It read project_members
// directly and returned "everything" only for the Owner, so a Super Admin,
// Admin or Super Manager - none of whom are normally rows in project_members -
// resolved to an empty set and got "No projects yet" on a fully populated org.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ memberProjects: string[], createdProjects: string[] }} */
const stub = { memberProjects: [], createdProjects: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      if (sql.includes("FROM project_members")) {
        return stub.memberProjects.map((id) => ({ project_id: id }));
      }
      if (sql.includes("FROM projects WHERE created_by")) {
        return stub.createdProjects.map((id) => ({ id }));
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

function reset({ memberProjects = [], createdProjects = [] } = {}) {
  stub.memberProjects = memberProjects;
  stub.createdProjects = createdProjects;
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
