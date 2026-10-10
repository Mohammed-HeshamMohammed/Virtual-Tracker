// A session row holds only the seconds the session itself earned. The agent reports a running total
// - it seeds a new task session with the task's lifetime total and re-opens a reaped session with its
// whole earlier total - and every total in the product is a SUM over sessions, so storing that running
// total as the session's own seconds re-counted the seed for each new session and counted a reaped
// session's hours twice. Mocked queries can't prove SQL sums, so this runs the real functions against
// a real Postgres (PGlite). If it is not installed this file skips itself.
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
  test("session seeds against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const url = (rel) => pathToFileURL(`${SRC}/${rel}`).href;

  const db = new PGlite();
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`
    CREATE TABLE members (id uuid PRIMARY KEY, timezone text);
    CREATE TABLE projects (id uuid PRIMARY KEY, timezone text);
    CREATE TABLE project_members (project_id uuid, member_id uuid, timezone text);
    CREATE TABLE activity_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid, project_id uuid, task_id uuid,
      status text, started_at timestamptz, ended_at timestamptz,
      active_seconds int NOT NULL DEFAULT 0, idle_seconds int NOT NULL DEFAULT 0,
      seed_active_seconds int NOT NULL DEFAULT 0, seed_idle_seconds int NOT NULL DEFAULT 0,
      source text, updated_at timestamptz, stop_reason text, stop_note text, stopped_by uuid,
      pause_reason text, paused_at timestamptz);
    CREATE TABLE activity_session_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid,
      member_id uuid, action text, reason text, actor_id uuid, source text, client_version text,
      created_at timestamptz DEFAULT now());
    CREATE TABLE daily_member_active_seconds (member_id uuid, day date, active_seconds bigint,
      updated_at timestamptz DEFAULT now(), PRIMARY KEY (member_id, day));
    CREATE TABLE daily_member_task_active_seconds (member_id uuid, task_id uuid, day date, active_seconds bigint,
      updated_at timestamptz DEFAULT now(), PRIMARY KEY (member_id, task_id, day));
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

  const M = "11111111-1111-4111-8111-111111111111";
  const P = "22222222-2222-4222-8222-222222222222";
  const T = "33333333-3333-4333-8333-333333333333";
  await db.query("INSERT INTO members VALUES ($1, 'UTC')", [M]);
  await db.query("INSERT INTO projects VALUES ($1, NULL)", [P]);

  let n = 0;
  const sid = () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const at = (iso) => new Date(iso);

  async function begin({ startedAt, taskId = null, active = 0, idle = 0, recovered = false }) {
    return svc.createPgSession(
      {
        id: sid(), memberId: M, taskId, projectId: P, status: "active",
        startedAt: at(startedAt), endedAt: null, activeSeconds: active, idleSeconds: idle,
        source: "agent", updatedAt: at(startedAt),
      },
      { recoveredAfterReap: recovered },
    );
  }
  const sync = (id, active, idle = 0, options) =>
    svc.updatePgSession(id, { updatedAt: new Date(), activeSeconds: active, idleSeconds: idle }, options);
  const stop = (id, active, idle = 0) =>
    svc.updatePgSession(id, { status: "stopped", endedAt: new Date(), activeSeconds: active, idleSeconds: idle }, { allowDecrease: true });
  const reap = (id) => svc.updatePgSession(id, { status: "stopped", endedAt: new Date(), stopReason: "abandoned_reap" });
  const row = async (id) => (await db.query("SELECT * FROM activity_sessions WHERE id = $1", [id])).rows[0];
  const day = (d) => svc.sumDailyMemberActiveSeconds(M, { fromDay: d, toDay: d, timeZone: "UTC" });

  test("a new task session does not re-count the task's earlier total", async () => {
    // Day 1: the task starts at 0 and reaches 8h.
    const d1 = await begin({ startedAt: "2026-10-05T08:00:00Z", taskId: T, active: 0 });
    await sync(d1.id, 28800);
    await stop(d1.id, 28800);
    // Day 2: the agent seeds the new session with the task's lifetime 8h, then works 30 min.
    const d2 = await begin({ startedAt: "2026-10-06T08:00:00Z", taskId: T, active: 28800 });
    await sync(d2.id, 28800 + 1800);
    await stop(d2.id, 28800 + 1800);

    assert.equal(await day("2026-10-05"), 28800);
    assert.equal(await day("2026-10-06"), 1800); // not 30600
    const stored = await row(d2.id);
    assert.equal(stored.active_seconds, 1800);
    assert.equal(stored.seed_active_seconds, 28800);
    // ...and the client is still told the running total it reported.
    assert.deepEqual(svc.sessionRunningTotals(stored), { activeSeconds: 30600, idleSeconds: 0 });
  });

  test("a recovered session adds only what the reaped one never received", async () => {
    const a = await begin({ startedAt: "2026-10-07T08:00:00Z", active: 0 });
    await sync(a.id, 600);
    await reap(a.id); // the server holds 600 for it
    // The agent kept counting offline and is at 700 when it re-opens the session.
    const b = await begin({ startedAt: "2026-10-07T08:12:00Z", active: 700, recovered: true });
    assert.equal((await row(b.id)).active_seconds, 100);
    assert.equal((await row(b.id)).seed_active_seconds, 600);
    await sync(b.id, 760);

    assert.equal(await day("2026-10-07"), 760); // 600 + 160, not 600 + 760
    assert.equal(svc.sessionRunningTotals(await row(b.id)).activeSeconds, 760);
  });

  test("a recovery with no reaped session to match drops the unsynced seconds rather than count twice", async () => {
    // On a task nothing was reaped for (the session reaped above was task-less), so there is nothing to match.
    const b = await begin({ startedAt: "2026-10-08T08:00:00Z", taskId: T, active: 700, recovered: true });
    assert.equal((await row(b.id)).active_seconds, 0);
    assert.equal(await day("2026-10-08"), 0);
    await sync(b.id, 730);
    assert.equal(await day("2026-10-08"), 30);
  });

  test("a session written before seeds existed (seed 0) behaves exactly as it did", async () => {
    const id = sid();
    await db.query(
      `INSERT INTO activity_sessions (id, member_id, status, started_at, active_seconds, idle_seconds, source, updated_at)
       VALUES ($1, $2, 'active', '2026-10-09T08:00:00Z', 500, 20, 'agent', now())`,
      [id, M],
    );
    await sync(id, 800, 25);
    const stored = await row(id);
    assert.equal(stored.active_seconds, 800);
    assert.equal(stored.idle_seconds, 25);
    assert.equal(await day("2026-10-09"), 800);
  });

  test("a downward write is still refused on sync, but an idle-rewind stop is accepted, in the session's own terms", async () => {
    const s = await begin({ startedAt: "2026-10-12T08:00:00Z", taskId: T, active: 1000 });
    await sync(s.id, 1600); // 600 earned
    await sync(s.id, 1200); // a late, lower write: refused
    assert.equal((await row(s.id)).active_seconds, 600);
    await stop(s.id, 1300); // the idle rewind: 300 earned
    assert.equal((await row(s.id)).active_seconds, 300);
    assert.equal(await day("2026-10-12"), 300);
  });
}
