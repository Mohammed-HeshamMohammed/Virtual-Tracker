// The queries the day rule touched, run against a real Postgres (PGlite) and checked by what they
// return - not by what their SQL text looks like. These replace regex assertions on the query string,
// which only proved the SQL said what it was written to say. Skips itself when PGlite is missing.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  /* not installed */
}

if (!PGlite) {
  test("day-rule queries against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const url = (rel) => pathToFileURL(`${SRC}/${rel}`).href;

  const db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`
    CREATE TABLE members (id uuid PRIMARY KEY, timezone text, tenant_id uuid, status text DEFAULT 'active');
    CREATE TABLE projects (id uuid PRIMARY KEY, timezone text, tenant_id uuid, status text DEFAULT 'active');
    CREATE TABLE project_members (project_id uuid, member_id uuid, timezone text);
    CREATE TABLE tasks (id uuid PRIMARY KEY, project_id uuid, title text);
    CREATE TABLE apps (id uuid PRIMARY KEY, name text);
    CREATE TABLE activity_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid, project_id uuid, task_id uuid, tenant_id uuid,
      status text DEFAULT 'stopped', started_at timestamptz, ended_at timestamptz,
      active_seconds int NOT NULL DEFAULT 0, idle_seconds int NOT NULL DEFAULT 0,
      seed_active_seconds int NOT NULL DEFAULT 0, seed_idle_seconds int NOT NULL DEFAULT 0);
    CREATE TABLE activity_app_logs (member_id uuid, session_id varchar(128), task_id uuid, app_id uuid, started_at timestamptz, duration_seconds int);
    CREATE TABLE activity_url_logs (member_id uuid, session_id varchar(128), visited_at timestamptz);
    CREATE TABLE activity_screenshots (member_id uuid, session_id varchar(128), captured_at timestamptz);
    CREATE TABLE time_entries (member_id uuid, date date);
    CREATE TABLE pay_rates (member_id uuid, rate numeric, type text, currency text);
    CREATE TABLE pay_rate_history (member_id uuid, rate numeric, type text, currency text, effective_date date, created_at timestamptz DEFAULT now());
  `);

  const run = async (sql, params) => (await db.query(sql, params)).rows;
  mock.module(url("lib/postgres/client.js"), {
    namedExports: {
      queryRaw: async (sql, params) => db.query(sql, params),
      query: run,
      queryAsAdmin: run,
      queryAsReadonlyCrossTenant: async (_tenant, sql, params) => run(sql, params),
      withTransaction: async (fn) => fn({ query: (sql, params) => db.query(sql, params) }),
      withTransactionAsAdmin: async (fn) => fn({ query: (sql, params) => db.query(sql, params) }),
      withTenant: async (_t, fn) => fn(),
      __closePostgresPoolForTests: async () => null,
      isPostgresConfigured: () => true,
      probePostgresReadiness: async () => null,
      getPostgresPool: () => null,
      getAdminPostgresPool: () => null,
      getReadonlyCrossTenantPostgresPool: () => null,
      isTenancyEnforced: () => false,
    },
  });
  mock.module(url("http/sanitize-error.js"), {
    namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
  });

  const events = await import(url("lib/postgres/activity-events-postgres.service.js"));
  const reports = await import(url("lib/postgres/misc-reports-postgres.service.js"));
  const readonly = await import(url("modules/customer-accounts/readonly-view.service.js"));

  let n = 0;
  const uuid = (prefix) => `${prefix}-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const member = async (zone, tenant = null) => {
    const id = uuid("aaaaaaaa");
    await db.query("INSERT INTO members (id, timezone, tenant_id) VALUES ($1, $2, $3)", [id, zone, tenant]);
    return id;
  };
  const project = async (zone = null, tenant = null) => {
    const id = uuid("bbbbbbbb");
    await db.query("INSERT INTO projects (id, timezone, tenant_id) VALUES ($1, $2, $3)", [id, zone, tenant]);
    return id;
  };
  const session = async ({ memberId, projectId, startedAt, active, tenant = null }) => {
    const id = uuid("cccccccc");
    await db.query(
      "INSERT INTO activity_sessions (id, member_id, project_id, tenant_id, started_at, active_seconds) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, memberId, projectId, tenant, startedAt, active],
    );
    return id;
  };

  test("an app's time on a project lands on its session's day in the project's calendar", async () => {
    const m = await member("Africa/Cairo");
    const ny = await project("America/New_York");
    const app = uuid("dddddddd");
    await db.query("INSERT INTO apps VALUES ($1, 'Figma')", [app]);
    // Session at 23:00 UTC Oct 9 = Oct 9 in New York. A slice logged at 01:30 UTC Oct 10 (Oct 10
    // in both zones) still belongs to the session's Oct 9.
    const s = await session({ memberId: m, projectId: ny, startedAt: "2026-10-09T23:00:00Z", active: 0 });
    await db.query("INSERT INTO activity_app_logs VALUES ($1,$2,NULL,$3,'2026-10-10T01:30:00Z',600)", [m, s, app]);

    const oct9 = await events.sumAppLogSecondsByAppNameForProjectPg(m, ny, { fromDay: "2026-10-09", toDay: "2026-10-09" });
    const oct10 = await events.sumAppLogSecondsByAppNameForProjectPg(m, ny, { fromDay: "2026-10-10", toDay: "2026-10-10" });
    assert.equal(oct9.totalSeconds, 600);
    assert.equal(oct9.apps[0].app_name, "Figma");
    assert.equal(oct10.totalSeconds, 0);
  });

  test("daily pay amounts come from the sessions, per project when filtered, at the rate in force that day", async () => {
    const m = await member("UTC");
    const a = await project();
    const b = await project();
    await session({ memberId: m, projectId: a, startedAt: "2026-08-03T09:00:00Z", active: 3600 });
    await session({ memberId: m, projectId: b, startedAt: "2026-08-03T13:00:00Z", active: 1800 });
    await session({ memberId: m, projectId: a, startedAt: "2026-08-20T09:00:00Z", active: 7200 });
    await db.query("INSERT INTO pay_rates VALUES ($1, 10, 'hourly', 'USD')", [m]);
    await db.query("INSERT INTO pay_rate_history (member_id, rate, type, currency, effective_date) VALUES ($1, 20, 'hourly', 'USD', '2026-08-15')", [m]);

    const all = await reports.getMemberDailyAmountRowsPg({ memberIds: [m], fromDay: "2026-08-01", toDay: "2026-08-31" });
    assert.deepEqual(all.map((r) => [r.day, r.activeSeconds, r.rate]), [["2026-08-03", 5400, 10], ["2026-08-20", 7200, 20]]);

    const onlyA = await reports.getMemberDailyAmountRowsPg({ memberIds: [m], fromDay: "2026-08-01", toDay: "2026-08-31", projectIds: [a] });
    assert.deepEqual(onlyA.map((r) => [r.day, r.activeSeconds]), [["2026-08-03", 3600], ["2026-08-20", 7200]]);
  });

  test("the read-only account view sums the last 7 days of its own tenant only", async () => {
    const t1 = uuid("eeeeeeee");
    const t2 = uuid("eeeeeeee");
    const m1 = await member("UTC", t1);
    const m2 = await member("UTC", t2);
    const p1 = await project(null, t1);
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    const old = new Date(Date.now() - 20 * 86400_000).toISOString();
    await session({ memberId: m1, projectId: p1, startedAt: recent, active: 900, tenant: t1 });
    await session({ memberId: m1, projectId: p1, startedAt: old, active: 5000, tenant: t1 });
    await session({ memberId: m2, projectId: null, startedAt: recent, active: 4444, tenant: t2 });

    const summary = await readonly.getCustomerActivitySummary(t1);
    assert.equal(Number(summary.active_members), 1);
    assert.equal(Number(summary.active_projects), 1);
    assert.equal(Number(summary.active_seconds_7d), 900);
  });

  test("deleting a day removes that day's sessions by their own calendar, with everything they captured", async () => {
    const m = await member("Africa/Cairo");
    const ny = await project("America/New_York");
    // Oct 4 in New York (02:00 UTC Oct 5), and a session on Cairo's Oct 5 on a project with no zone.
    const keep = await session({ memberId: m, projectId: null, startedAt: "2026-10-05T09:00:00Z", active: 100 });
    const gone = await session({ memberId: m, projectId: ny, startedAt: "2026-10-05T02:00:00Z", active: 200 });
    // The doomed session kept capturing past midnight; the kept one has its own slice.
    await db.query("INSERT INTO activity_screenshots VALUES ($1,$2,'2026-10-05T06:00:00Z'), ($1,$3,'2026-10-05T10:00:00Z')", [m, gone, keep]);
    await db.query("INSERT INTO activity_url_logs VALUES ($1,$2,'2026-10-05T06:00:00Z')", [m, gone]);

    const result = await events.deleteMemberDayActivityWithChildrenPg(m, "2026-10-04");
    assert.equal(result.sessions, 1);
    assert.equal(result.screenshots, 1);
    assert.equal(result.urlLogs, 1);
    const left = await run("SELECT id FROM activity_sessions WHERE member_id = $1", [m]);
    assert.deepEqual(left.map((r) => r.id), [keep]);
    const shotsLeft = await run("SELECT session_id FROM activity_screenshots WHERE member_id = $1", [m]);
    assert.deepEqual(shotsLeft.map((r) => r.session_id), [keep]);
  });
}
