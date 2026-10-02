// The member's totals are summed from sessions in the calendar they are read in, with Postgres doing
// the cutting (AT TIME ZONE). Mocked queries can't prove that SQL, so this runs the real functions
// against a real Postgres - PGlite, Postgres compiled to WebAssembly (already a dev dependency,
// used by the tenancy proof harness). If it is ever missing this file skips itself.
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
  test("session calendar sums against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const url = (rel) => pathToFileURL(`${SRC}/${rel}`).href;

  const db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'"); // production's database session zone
  await db.exec(`
    CREATE TABLE members (id uuid PRIMARY KEY, timezone text);
    CREATE TABLE activity_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid, project_id uuid, task_id uuid,
      started_at timestamptz, active_seconds int, idle_seconds int);
    CREATE TABLE time_entries (project_id uuid, member_id uuid, duration int, date date, status text, billable boolean);
    CREATE INDEX ON activity_sessions (member_id, started_at DESC);
  `);

  mock.module(url("lib/postgres/client.js"), {
    namedExports: {
      queryRaw: async (sql, params) => db.query(sql, params),
      query: async (sql, params) => (await db.query(sql, params)).rows,
      __closePostgresPoolForTests: async () => null,
      isPostgresConfigured: () => true,
      probePostgresReadiness: async () => null,
      withTransaction: async () => null,
      getPostgresPool: () => null,
      getAdminPostgresPool: () => null,
      getReadonlyCrossTenantPostgresPool: () => null,
      isTenancyEnforced: () => false,
      queryAsReadonlyCrossTenant: async (sql, params) => (await db.query(sql, params)).rows,
      withTransactionAsAdmin: async () => null,
      queryAsAdmin: async (sql, params) => (await db.query(sql, params)).rows,
      withTenant: async (_t, fn) => fn(),
    },
  });
  mock.module(url("http/sanitize-error.js"), {
    namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
  });

  const svc = await import(url("lib/postgres/activity-events-postgres.service.js"));
  const proj = await import(url("lib/postgres/projects-postgres.service.js"));

  const M = "11111111-1111-4111-8111-111111111111";
  const P = "22222222-2222-4222-8222-222222222222";
  await db.query("INSERT INTO members VALUES ($1, 'Africa/Cairo')", [M]);

  async function session(startedAt, active, idle = 0, projectId = P) {
    await db.query(
      "INSERT INTO activity_sessions (member_id, project_id, started_at, active_seconds, idle_seconds) VALUES ($1,$2,$3,$4,$5)",
      [M, projectId, startedAt, active, idle],
    );
  }

  // 22:30 UTC on Jan 1 is 00:30 on Jan 2 in Cairo (UTC+2), 17:30 Jan 1 in New York (UTC-5), 11:30 Jan 2 in Kiritimati (UTC+14)... check below.
  await session("2026-01-01T22:30:00Z", 3600, 60);   // A
  await session("2026-01-02T10:00:00Z", 1800, 30);   // B
  await session("2026-01-03T01:00:00Z", 900, 10);    // C

  const day = (from, to, tz) => svc.sumDailyMemberActiveSeconds(M, { fromDay: from, toDay: to, timeZone: tz });

  test("the same sessions fall on different days depending on the calendar they are read in", async () => {
    // Cairo (UTC+2): A -> Jan 2, B -> Jan 2, C -> Jan 3.
    assert.equal(await day("2026-01-02", "2026-01-02", "Africa/Cairo"), 3600 + 1800);
    assert.equal(await day("2026-01-03", "2026-01-03", "Africa/Cairo"), 900);
    // New York (UTC-5): A -> Jan 1, B -> Jan 2, C -> Jan 2.
    assert.equal(await day("2026-01-01", "2026-01-01", "America/New_York"), 3600);
    assert.equal(await day("2026-01-02", "2026-01-02", "America/New_York"), 1800 + 900);
  });

  test("with no zone given, the member's own zone is used", async () => {
    assert.equal(await day("2026-01-02", "2026-01-02", null), 3600 + 1800);
    assert.equal(await day("2026-01-02", "2026-01-02", ""), 3600 + 1800);
  });

  test("the whole week adds up to the same total in every calendar, and the days add up to the week", async () => {
    for (const tz of ["Africa/Cairo", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      assert.equal(await day("2025-12-29", "2026-01-04", tz), 3600 + 1800 + 900, tz);
      const rows = await svc.listDailyMemberActiveSeconds(M, { fromDay: "2025-12-29", toDay: "2026-01-04", timeZone: tz });
      assert.equal(rows.reduce((n, r) => n + Number(r.active_seconds), 0), 3600 + 1800 + 900, tz);
      assert.ok(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day)), "days come back as plain strings");
    }
  });

  test("active, idle, the project figure and the week list all agree on one calendar", async () => {
    const tz = "America/New_York";
    const today = await svc.sumMemberActiveIdleSeconds(M, { fromDay: "2026-01-02", toDay: "2026-01-02", timeZone: tz });
    assert.deepEqual(today, { activeSeconds: 1800 + 900, idleSeconds: 30 + 10 });
    const forProject = await svc.sumMemberActiveIdleSecondsForProject(M, P, { fromDay: "2026-01-02", toDay: "2026-01-02", timeZone: tz });
    assert.deepEqual(forProject, today);
    const idle = await svc.listMemberIdleSecondsByDay(M, { fromDay: "2025-12-29", toDay: "2026-01-04", timeZone: tz });
    assert.equal(Number(idle.find((r) => r.day === "2026-01-02").idle_seconds), 40);
    const active = await svc.listDailyMemberActiveSeconds(M, { fromDay: "2025-12-29", toDay: "2026-01-04", timeZone: tz });
    assert.equal(Number(active.find((r) => r.day === "2026-01-02").active_seconds), 2700);
  });

  test("another member's sessions never leak in", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    await db.query("INSERT INTO members VALUES ($1, 'UTC')", [other]);
    await db.query("INSERT INTO activity_sessions (member_id, project_id, started_at, active_seconds, idle_seconds) VALUES ($1,$2,'2026-01-02T10:00:00Z',9999,0)", [other, P]);
    assert.equal(await day("2026-01-02", "2026-01-02", "Africa/Cairo"), 5400);
  });

  test("project limit windows are cut at the project's midnights", async () => {
    await db.query("INSERT INTO time_entries VALUES ($1,$2,120,'2026-01-02','approved',true)", [P, M]);
    // from Jan 2 in Cairo: A (Jan 2 00:30 Cairo) + B + C + the 120s manual entry
    const cairo = await proj.getProjectTrackedSecondsPg(P, { memberId: M, fromDate: "2026-01-02", timeZone: "Africa/Cairo" });
    assert.equal(cairo, 3600 + 1800 + 900 + 120);
    // from Jan 2 in New York: A is still Jan 1 there, so it drops out
    const ny = await proj.getProjectTrackedSecondsPg(P, { memberId: M, fromDate: "2026-01-02", timeZone: "America/New_York" });
    assert.equal(ny, 1800 + 900 + 120);
    // no zone: unchanged behaviour (UTC date)
    const utc = await proj.getProjectTrackedSecondsPg(P, { memberId: M, fromDate: "2026-01-02" });
    assert.equal(utc, 1800 + 900 + 120);
  });

  test("a session on the exact midnight boundary counts once", async () => {
    await db.query("INSERT INTO members VALUES ('44444444-4444-4444-8444-444444444444', 'UTC')");
    const m = "44444444-4444-4444-8444-444444444444";
    await db.query("INSERT INTO activity_sessions (member_id, project_id, started_at, active_seconds, idle_seconds) VALUES ($1,$2,'2026-03-10T00:00:00Z',100,0)", [m, P]);
    const d1 = await svc.sumDailyMemberActiveSeconds(m, { fromDay: "2026-03-09", toDay: "2026-03-09", timeZone: "UTC" });
    const d2 = await svc.sumDailyMemberActiveSeconds(m, { fromDay: "2026-03-10", toDay: "2026-03-10", timeZone: "UTC" });
    assert.equal(d1, 0);
    assert.equal(d2, 100);
  });

  test("a task's day is cut in the calendar it is read in, from its own sessions", async () => {
    const T = "55555555-5555-4555-8555-555555555555";
    const U = "66666666-6666-4666-8666-666666666666";
    const m = "77777777-7777-4777-8777-777777777777";
    await db.query("INSERT INTO members VALUES ($1, 'UTC')", [m]);
    const add = (started, secs, task) =>
      db.query("INSERT INTO activity_sessions (member_id, project_id, task_id, started_at, active_seconds, idle_seconds) VALUES ($1,$2,$3,$4,$5,0)", [m, P, task, started, secs]);
    await add("2026-02-01T23:00:00Z", 600, T); // Feb 2 in Cairo, Feb 1 in New York
    await add("2026-02-02T09:00:00Z", 300, T);
    await add("2026-02-02T09:00:00Z", 9999, U); // another task
    assert.equal(await svc.sumDailyMemberTaskActiveSeconds(m, T, "2026-02-02", "Africa/Cairo"), 900);
    assert.equal(await svc.sumDailyMemberTaskActiveSeconds(m, T, "2026-02-02", "America/New_York"), 300);
    assert.equal(await svc.sumDailyMemberTaskActiveSecondsRange(m, T, { fromDay: "2026-02-01", toDay: "2026-02-02", timeZone: "America/New_York" }), 900);
  });
}
