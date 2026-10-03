// Budget changes reach the tracker: saving a budget (or a member limit, or the project) pushes a
// live "changed" frame to everyone on the project, and the budget status the tracker reads says
// which period it covers. Through the real projects router against real Postgres (PGlite).
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
  test("budget live push (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`
    CREATE TABLE projects (
      id uuid PRIMARY KEY, name text, type text DEFAULT 'normal', status text DEFAULT 'active', end_date date, timezone text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), updated_by uuid,
      managers_can_edit_budget boolean NOT NULL DEFAULT true, managers_can_edit_member_limits boolean NOT NULL DEFAULT true,
      managers_can_edit_members boolean NOT NULL DEFAULT true, budget_enabled boolean NOT NULL DEFAULT true,
      member_limits_enabled boolean NOT NULL DEFAULT true);
    CREATE TABLE project_budgets (
      id uuid PRIMARY KEY, project_id uuid UNIQUE, type text, based_on text, scope text, cost numeric,
      notify_project_members boolean, notify_at_pct numeric, who_to_notify text, stop_timers_when_reached boolean,
      stop_timers_at_pct numeric, resets text, start_date date, end_date date, include_non_billable_time boolean,
      created_by uuid, updated_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE project_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, member_id uuid,
      project_role text, manager_can_track boolean DEFAULT false, timezone text, source text DEFAULT 'manual');
    CREATE TABLE project_member_limits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, member_id uuid, type text,
      based_on text, cost numeric, resets text, start_date date, notify_at_pct numeric, notify_project_members boolean,
      created_by uuid, updated_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      UNIQUE (project_id, member_id));
    CREATE TABLE activity_sessions (member_id uuid, project_id uuid, started_at timestamptz, active_seconds int);
    CREATE TABLE time_entries (project_id uuid, member_id uuid, duration int, date date, status text, billable boolean);
  `);

  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  mock.module("../src/lib/postgres/client.js", {
    namedExports: {
      isTenancyEnforced: () => false,
      getPostgresPool: () => null,
      getAdminPostgresPool: () => null,
      getReadonlyCrossTenantPostgresPool: () => null,
      isPostgresConfigured: () => true,
      query: rows,
      queryAsAdmin: rows,
      queryAsReadonlyCrossTenant: rows,
      queryRaw: async (sql, params) => db.query(sql, params),
      withTransaction: async () => null,
      withTransactionAsAdmin: async () => null,
      withTenant: async (_t, fn) => fn(),
      probePostgresReadiness: async () => null,
      __closePostgresPoolForTests: async () => null,
    },
  });
  mock.module("../src/http/sanitize-error.js", {
    namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
  });
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
  const { presenceEventsSince, currentPresenceCursor } = await import("../src/modules/presence/presence-event-log.js");

  const P = "99999999-9999-4999-8999-999999999999";
  const ALICE = "11111111-1111-4111-8111-111111111111";
  const BOB = "22222222-2222-4222-8222-222222222222";
  const OUTSIDER = "33333333-3333-4333-8333-333333333333";
  await db.query("INSERT INTO projects (id, name) VALUES ($1, 'Live project')", [P]);
  await db.query("INSERT INTO project_members (project_id, member_id, project_role) VALUES ($1,$2,'user'), ($1,$3,'manager')", [P, ALICE, BOB]);

  async function call(method, path, body, roleName = "Admin") {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = { "content-type": "application/json" };
    setAuthContext(req, { memberId: "44444444-4444-4444-8444-444444444444", roleName, uid: "u1" });
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
    await routeProjects(req, res, new URL(`http://localhost${path}`), null, "http://localhost");
    return out;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const framesFor = (memberId, since) =>
    presenceEventsSince(memberId, since).events.filter((e) => e.type === "changed");

  test("saving a budget pushes a live frame to everyone on the project, and only them", async () => {
    const before = currentPresenceCursor();
    const r = await call("POST", "/api/project-budgets", { project_id: P, type: "Hours based", scope: "per_project", cost: 40, resets: "Never" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await settle();
    for (const member of [ALICE, BOB]) {
      const frame = framesFor(member, before).find((f) => f.resource === "project-budgets");
      assert.ok(frame, `${member} is told`);
      assert.equal(frame.id, P);
      assert.equal(frame.action, "updated");
    }
    assert.equal(framesFor(OUTSIDER, before).length, 0, "someone not on the project is not told");
  });

  test("editing the budget, restarting its period, a member limit and the project itself each push one too", async () => {
    const budgetId = (await db.query("SELECT id FROM project_budgets WHERE project_id = $1", [P])).rows[0].id;
    const cases = [
      ["PATCH", `/api/project-budgets/${budgetId}`, { cost: 50 }, "project-budgets"],
      ["PATCH", `/api/projects/${P}/budget-anchor`, { start_date: "2026-01-01" }, "project-budgets"],
      ["POST", "/api/project-member-limits", { project_id: P, member_id: ALICE, type: "Hours limit", cost: 5 }, "project-member-limits"],
      ["DELETE", `/api/project-member-limits?project_id=${P}&member_id=${ALICE}`, undefined, "project-member-limits"],
      ["PATCH", `/api/projects/${P}`, { name: "Renamed" }, "projects"],
    ];
    for (const [method, path, body, resource] of cases) {
      const before = currentPresenceCursor();
      const r = await call(method, path, body);
      assert.equal(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`);
      await settle();
      assert.ok(framesFor(ALICE, before).some((f) => f.resource === resource), `${method} ${path} -> ${resource}`);
    }
  });

  test("a failed save pushes nothing", async () => {
    const before = currentPresenceCursor();
    const r = await call("POST", "/api/project-budgets", { project_id: P, type: "Hours based", cost: 0 });
    assert.equal(r.status, 400);
    await settle();
    assert.equal(framesFor(ALICE, before).length, 0);
  });

  test("the budget status says which period the spend is for", async () => {
    const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    await call("POST", "/api/project-budgets", {
      project_id: P, type: "Hours based", scope: "per_project", cost: 40, resets: "Monthly", start_date: day(-45),
    });
    const r = await call("GET", `/api/projects/${P}/budget-status`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.resets, "monthly");
    assert.match(r.body.data.periodStart, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.body.data.periodEnd, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.body.data.periodStart <= day(0) && day(0) <= r.body.data.periodEnd, "today is in the period");
    assert.equal(r.body.data.capSeconds, 40 * 3600);
  });

  test("a budget that never resets reports no period end", async () => {
    await call("POST", "/api/project-budgets", { project_id: P, type: "Hours based", scope: "per_project", cost: 40, resets: "Never" });
    const r = await call("GET", `/api/projects/${P}/budget-status`);
    assert.equal(r.body.data.resets, "never");
    assert.equal(r.body.data.periodEnd, null);
  });
}
