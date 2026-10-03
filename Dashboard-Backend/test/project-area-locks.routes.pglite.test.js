// The Management tab's locks, end to end through the real projects router: a plain manager is
// refused writes to a locked area, admins are not, and only the Management-tab roles can flip the
// switches. Runs against a real Postgres (PGlite); skips itself if that is not installed.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  /* not installed */
}

if (!PGlite) {
  test("project area locks through the router (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`
    CREATE TABLE projects (
      id uuid PRIMARY KEY, name text, type text DEFAULT 'normal', status text DEFAULT 'active', end_date date,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), updated_by uuid,
      managers_can_edit_budget boolean NOT NULL DEFAULT true,
      managers_can_edit_member_limits boolean NOT NULL DEFAULT true,
      managers_can_edit_members boolean NOT NULL DEFAULT true,
      budget_enabled boolean NOT NULL DEFAULT true,
      member_limits_enabled boolean NOT NULL DEFAULT true);
    CREATE TABLE project_budgets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid UNIQUE);
    CREATE TABLE project_member_limits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, member_id uuid);
  `);

  const queryRows = async (sql, params) => (await db.query(sql, params)).rows;
  mock.module("../src/lib/postgres/client.js", {
    namedExports: {
      isTenancyEnforced: () => false,
      getPostgresPool: () => null,
      getAdminPostgresPool: () => null,
      getReadonlyCrossTenantPostgresPool: () => null,
      isPostgresConfigured: () => true,
      query: queryRows,
      queryAsAdmin: queryRows,
      queryAsReadonlyCrossTenant: queryRows,
      queryRaw: async (sql, params) => db.query(sql, params),
      withTransaction: async (fn) => fn({ query: async (sql, params) => db.query(sql, params) }),
      withTransactionAsAdmin: async (fn) => fn({ query: async (sql, params) => db.query(sql, params) }),
      withTenant: async (_t, fn) => fn(),
      probePostgresReadiness: async () => null,
      __closePostgresPoolForTests: async () => null,
    },
  });
  mock.module("../src/http/sanitize-error.js", {
    namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
  });
  // Project scope is not what is under test: every viewer here may write this project.
  mock.module("../src/http/project-access.js", {
    namedExports: {
      getViewerProjectIds: async () => null,
      clientMayManageProject: async () => false,
      clientMayTrackProject: async () => false,
      isOrgProjectAdminRole: () => false,
      viewerCanCreateProjectTasks: async () => true,
      isProjectMemberForTimer: async () => true,
      listTrackableProjectIdsPg: async () => [],
      viewerCanWriteProject: async () => true,
      toAllowedProjectSet: () => null,
      assertProjectAccessible: async () => true,
      assertAuthenticated: () => true,
    },
  });

  const { setAuthContext } = await import("../src/http/auth-context.js");
  const { routeProjects } = await import("../src/modules/projects/routes.js");

  const P = "99999999-9999-4999-8999-999999999999";
  const MEMBER = "11111111-1111-4111-8111-111111111111";
  await db.query("INSERT INTO projects (id, name) VALUES ($1, 'Locked project')", [P]);

  async function call(method, path, body, roleName) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = { "content-type": "application/json" };
    setAuthContext(req, { memberId: "22222222-2222-4222-8222-222222222222", roleName, uid: "u1" });
    const out = { status: 0, body: null };
    const res = {
      writeHead: (status) => {
        out.status = status;
      },
      setHeader: () => {},
      end: (payload) => {
        out.body = payload ? JSON.parse(String(payload)) : null;
      },
    };
    const url = new URL(`http://localhost${path}`);
    await routeProjects(req, res, url, null, "http://localhost");
    return out;
  }

  const lock = (patch) =>
    db.query(
      `UPDATE projects SET managers_can_edit_budget = $2, managers_can_edit_member_limits = $3, managers_can_edit_members = $4 WHERE id = $1`,
      [P, patch.budget ?? true, patch.memberLimits ?? true, patch.members ?? true],
    );

  test("a locked budget refuses a manager's write and says why", async () => {
    await lock({ budget: false });
    const r = await call("POST", "/api/project-budgets", { project_id: P, type: "Hours based", cost: 10 }, "Manager");
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "PROJECT_AREA_LOCKED");
    assert.match(r.body.error, /budget/);
  });

  test("locked member limits refuse a manager's write and removal", async () => {
    await lock({ memberLimits: false });
    const add = await call("POST", "/api/project-member-limits", { project_id: P, member_id: MEMBER, type: "Hours limit", cost: 5 }, "Manager");
    assert.equal(add.status, 403);
    assert.equal(add.body.code, "PROJECT_AREA_LOCKED");
    const remove = await call("DELETE", `/api/project-member-limits?project_id=${P}&member_id=${MEMBER}`, undefined, "Manager");
    assert.equal(remove.status, 403);
  });

  test("locked members refuse a manager adding someone to the project", async () => {
    await lock({ members: false });
    const r = await call("POST", "/api/project-members", { project_id: P, member_id: MEMBER, project_role: "user" }, "Manager");
    assert.equal(r.status, 403);
    assert.match(r.body.error, /members and teams/);
  });

  test("an area that is not locked is not refused for the lock", async () => {
    await lock({ budget: false });
    const r = await call("DELETE", `/api/project-member-limits?project_id=${P}&member_id=${MEMBER}`, undefined, "Manager");
    assert.notEqual(r.body?.code, "PROJECT_AREA_LOCKED");
  });

  test("admins and super managers are never refused by a lock", async () => {
    await lock({ budget: false, memberLimits: false, members: false });
    for (const role of ["Admin", "Super Manager", "Owner"]) {
      const r = await call("DELETE", `/api/project-member-limits?project_id=${P}&member_id=${MEMBER}`, undefined, role);
      assert.notEqual(r.body?.code, "PROJECT_AREA_LOCKED", role);
      assert.notEqual(r.status, 403, role);
    }
  });

  test("only the Management-tab roles can change the switches themselves", async () => {
    const asManager = await call("PATCH", `/api/projects/${P}`, { managersCanEditBudget: true }, "Manager");
    assert.equal(asManager.status, 403);
    assert.match(asManager.body.error, /Management settings/);
    const row = (await db.query("SELECT managers_can_edit_budget FROM projects WHERE id = $1", [P])).rows[0];
    assert.equal(row.managers_can_edit_budget, false, "unchanged");
  });
}
