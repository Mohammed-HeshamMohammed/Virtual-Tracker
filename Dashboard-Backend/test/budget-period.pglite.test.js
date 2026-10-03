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

  test("the boot-time constraint change allows 'At end date', and can run every boot", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("../src/lib/postgres/ensure-lookup-schema.js", import.meta.url)), "utf8");
    const match = source.match(/`(ALTER TABLE project_budgets\s+DROP CONSTRAINT IF EXISTS project_budgets_resets_check,[\s\S]*?)`/);
    assert.ok(match, "found the statement in the schema file");
    // The table as it was first created: an unnamed inline CHECK Postgres names project_budgets_resets_check.
    await db.exec(`CREATE TABLE old_budgets (project_id uuid, resets varchar(20) NOT NULL DEFAULT 'Never' CHECK (resets IN ('Never', 'Weekly', 'Monthly')))`);
    await db.exec(`ALTER TABLE old_budgets RENAME CONSTRAINT old_budgets_resets_check TO project_budgets_resets_check`);
    const statement = match[1].replace(/project_budgets/g, "old_budgets").replace(/old_budgets_resets_check/g, "project_budgets_resets_check");
    await db.exec(statement);
    await db.exec(statement); // a second boot
    await db.query("INSERT INTO old_budgets (project_id, resets) VALUES (gen_random_uuid(), 'At end date')");
    await assert.rejects(db.query("INSERT INTO old_budgets (project_id, resets) VALUES (gen_random_uuid(), 'Daily')"));
  });

  test("an At end date budget counts only the current repeat of its window", async () => {
    const P2 = "33333333-3333-4333-8333-333333333333";
    await db.query("INSERT INTO projects (id) VALUES ($1)", [P2]);
    // A 10-day window starting 25 days ago repeats: windows are days -25..-16, -15..-6, -5..+4 (today is in the last).
    const day = (offset) => addLocalDays(today, offset);
    await db.query(
      "INSERT INTO project_budgets VALUES ($1, 'Hours based', NULL, 'per_project', 100, 'At end date', $2, $3, true)",
      [P2, day(-25), day(-16)],
    );
    const add = (offset, secs) => db.query("INSERT INTO activity_sessions VALUES ($1, $2, $3, $4)", [M, P2, `${day(offset)}T12:00:00Z`, secs]);
    await add(-20, 7200); // first window
    await add(-10, 3600); // second window
    await add(-2, 1800); // current window
    const spent = (await proj.computeProjectSpentForAllPg({}, [{ id: P2, type: "Hours based" }])).get(P2);
    assert.equal(spent, 0.5, "only the current window's half hour");
  });
}
