// A resetting budget counts only its current period - checked against a real Postgres (PGlite),
// since the period is cut in each project's own calendar inside the SQL. Skips itself without PGlite.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let PGlite = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  /* not installed */
}

if (!PGlite) {
  test("budget periods against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`
    CREATE TABLE projects (id uuid PRIMARY KEY, timezone text, budget_enabled boolean NOT NULL DEFAULT true);
    CREATE TABLE project_budgets (project_id uuid PRIMARY KEY, type text, based_on text, scope text, cost numeric,
      resets text, start_date date, end_date date, include_non_billable_time boolean DEFAULT true);
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

  const proj = await import("../src/lib/postgres/projects-postgres.service.js");
  const { budgetPeriodWindow } = await import("../src/lib/time/budget-period.js");
  const { localDayFor, addLocalDays } = await import("../src/lib/time/timezone-utils.js");

  const M = "11111111-1111-4111-8111-111111111111";
  const P = "22222222-2222-4222-8222-222222222222";
  const today = localDayFor(new Date(), "UTC");
  // A monthly budget that started on the 1st of last month: this month is its current period.
  const lastMonthFirst = (() => {
    const [y, m] = today.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return d.toISOString().slice(0, 10);
  })();

  await db.query("INSERT INTO projects (id) VALUES ($1)", [P]);
  await db.query(
    "INSERT INTO project_budgets VALUES ($1, 'Hours based', NULL, 'per_project', 100, 'Monthly', $2, NULL, true)",
    [P, lastMonthFirst],
  );
  const add = (day, secs) =>
    db.query("INSERT INTO activity_sessions VALUES ($1, $2, $3, $4)", [M, P, `${day}T12:00:00Z`, secs]);
  await add(lastMonthFirst, 7200); // last period
  await add(`${today.slice(0, 8)}01`, 3600); // this period
  await add(today, 1800); // this period

  test("a monthly budget's spend is only this month's", async () => {
    const window = budgetPeriodWindow({ resets: "Monthly", start_date: lastMonthFirst }, today);
    assert.equal(window.fromDay, `${today.slice(0, 8)}01`);
    const spent = await proj.computeProjectSpentForAllPg({}, [
      { id: P, type: "Hours based", include_non_billable_time: true, start_date: lastMonthFirst, end_date: null },
    ]);
    assert.equal(spent.get(P), Math.round(((3600 + 1800) / 3600) * 100) / 100);
    const single = await proj.computeProjectSpentPg({}, P, { type: "Hours based", include_non_billable_time: true });
    assert.equal(single, spent.get(P), "the single-project path agrees");
  });

  test("Never keeps counting everything from the start day, as before", async () => {
    await db.query("UPDATE project_budgets SET resets = 'Never' WHERE project_id = $1", [P]);
    const spent = await proj.computeProjectSpentForAllPg({}, [{ id: P, type: "Hours based", include_non_billable_time: true }]);
    assert.equal(spent.get(P), Math.round(((7200 + 3600 + 1800) / 3600) * 100) / 100);
    await db.query("UPDATE project_budgets SET resets = 'Monthly' WHERE project_id = $1", [P]);
  });

  test("the period is cut at the project's own midnight", async () => {
    // A session just before UTC midnight on the last day of the previous period is already in the
    // current period in Tokyo (UTC+9).
    const periodStart = `${today.slice(0, 8)}01`;
    const before = addLocalDays(periodStart, -1);
    await db.query("INSERT INTO activity_sessions VALUES ($1, $2, $3, 900)", [M, P, `${before}T20:00:00Z`]);
    const utcSpent = (await proj.computeProjectSpentForAllPg({}, [{ id: P, type: "Hours based" }])).get(P);
    await db.query("UPDATE projects SET timezone = 'Asia/Tokyo' WHERE id = $1", [P]);
    const tokyoSpent = (await proj.computeProjectSpentForAllPg({}, [{ id: P, type: "Hours based" }])).get(P);
    assert.equal(Math.round((tokyoSpent - utcSpent) * 3600), 900);
    await db.query("UPDATE projects SET timezone = NULL WHERE id = $1", [P]);
  });
}
