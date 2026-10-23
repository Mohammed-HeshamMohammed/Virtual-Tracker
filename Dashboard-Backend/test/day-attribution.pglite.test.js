// Which calendar day a session's hours land on. The agreed model (PLAN-timezone-and-day-boundary.md)
// is sticky start-day: every second a session earns belongs to the day it started, in the member's
// own calendar. The per-day rollup tables (daily_member_active_seconds and its task twin), which pay
// amounts, limit-usage reports and the counter-reconciliation sweep read, have to agree with that -
// otherwise a person's hours drift between days depending on which screen is looking. Runs against a
// real Postgres (PGlite); skips itself when it is not installed.
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
  test("day attribution against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
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
  `);

  const run = async (sql, params) => (await db.query(sql, params)).rows;
  mock.module(url("lib/postgres/client.js"), {
    namedExports: {
      queryRaw: async (sql, params) => db.query(sql, params),
      query: run,
      __closePostgresPoolForTests: async () => null,
      isPostgresConfigured: () => true,
      probePostgresReadiness: async () => null,
      withTransaction: async () => null,
      getPostgresPool: () => null,
      getAdminPostgresPool: () => null,
      getReadonlyCrossTenantPostgresPool: () => null,
      isTenancyEnforced: () => false,
      queryAsReadonlyCrossTenant: run,
      withTransactionAsAdmin: async () => null,
      queryAsAdmin: run,
      withTenant: async (_t, fn) => fn(),
    },
  });
  mock.module(url("http/sanitize-error.js"), {
    namedExports: { logSafeWarn: () => {}, logSafeError: () => {}, formatErrorForLog: async () => null, sanitizeErrorMessage: async () => null },
  });

  const svc = await import(url("lib/postgres/activity-events-postgres.service.js"));
  const reconciliation = await import(url("lib/postgres/counter-reconciliation-postgres.service.js"));
  const { __clearMemberTimezoneCache } = await import(url("modules/reports/member-timezones.js"));

  const P = "22222222-2222-4222-8222-222222222222";
  await db.query("INSERT INTO projects VALUES ($1, NULL)", [P]);

  let n = 0;
  const sid = () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const mid = () => `cccccccc-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  async function member(timeZone) {
    const id = mid();
    await db.query("INSERT INTO members VALUES ($1, $2)", [id, timeZone]);
    return id;
  }
  async function setZone(memberId, timeZone) {
    await db.query("UPDATE members SET timezone = $2 WHERE id = $1", [memberId, timeZone]);
    __clearMemberTimezoneCache();
  }
  async function begin(memberId, startedAt) {
    return svc.createPgSession({
      id: sid(), memberId, taskId: null, projectId: P, status: "active",
      startedAt: new Date(startedAt), endedAt: null, activeSeconds: 0, idleSeconds: 0,
      source: "agent", updatedAt: new Date(startedAt),
    });
  }
  const sync = (id, active) => svc.updatePgSession(id, { updatedAt: new Date(), activeSeconds: active, idleSeconds: 0 });

  test("a session's hours stay on one day when the member's zone changes mid-session", async () => {
    // 22:30 UTC on Oct 5 is 01:30 on Oct 6 in Cairo.
    const m = await member("UTC");
    const s = await begin(m, "2026-10-05T22:30:00Z");
    await sync(s.id, 600);
    // The member picks their real zone in the agent's title bar while the timer runs.
    await setZone(m, "Africa/Cairo");
    await sync(s.id, 1200);

    // Every figure a person sees is cut from the session when it is read, so the whole session moves
    // to Cairo's Oct 6 together. (The write-time rollup did split it 600/600; nothing shows it now.)
    const days = await svc.listDailyMemberActiveSeconds(m, { fromDay: "2026-10-04", toDay: "2026-10-07" });
    assert.deepEqual(days.map((d) => [d.day, Number(d.active_seconds)]), [["2026-10-06", 1200]]);
  });

  test("the reconciliation sweep cuts sessions into days in the member's calendar, like the rollup it checks", async () => {
    const m = await member("Africa/Cairo");
    const s = await begin(m, "2026-10-05T22:30:00Z"); // Oct 6 in Cairo
    await sync(s.id, 900);
    __clearMemberTimezoneCache();

    const fromSessions = await reconciliation.fetchSessionActiveSecondsByMemberForDayPg("2026-10-06");
    const fromRollup = await reconciliation.fetchDailyRollupByMemberForDayPg("2026-10-06");
    assert.equal(fromRollup.get(m), 900, "precondition: the rollup books it to Cairo's Oct 6");
    assert.equal(fromSessions.get(m) ?? 0, 900, "sessions read for the same day must agree, or it reports drift that is not there");
  });

  test("a pause that crosses midnight: the old day keeps its hours, the new day gets only today's", async () => {
    const { closeIfPausedAcrossDays } = await import(url("modules/activity/day-rollover.js"));
    const m = await member("Africa/Cairo");
    __clearMemberTimezoneCache();
    const rowOf = async (id) => (await db.query("SELECT * FROM activity_sessions WHERE id = $1", [id])).rows[0];
    const dayOf = (d) => svc.sumDailyMemberActiveSeconds(m, { fromDay: d, toDay: d });

    // Monday 09:00 Cairo: an hour of work, then Pause at the end of the day.
    const mon = await begin(m, "2026-10-12T06:00:00Z");
    await sync(mon.id, 3600);
    await svc.updatePgSession(mon.id, { status: "idle", updatedAt: new Date() });

    // Same-day resume and a running session are left alone.
    assert.equal(await closeIfPausedAcrossDays(await rowOf(mon.id), { memberId: m, now: new Date("2026-10-12T15:00:00Z"), source: "agent" }), null);
    assert.equal(await closeIfPausedAcrossDays({ ...(await rowOf(mon.id)), status: "active" }, { memberId: m, now: new Date("2026-10-13T07:00:00Z"), source: "agent" }), null);

    // Tuesday 10:00 Cairo: Resume.
    const tue = new Date("2026-10-13T07:00:00Z");
    const rolled = await closeIfPausedAcrossDays(await rowOf(mon.id), { memberId: m, now: tue, source: "agent" });
    assert.deepEqual(rolled, { taskId: null, totals: { activeSeconds: 3600, idleSeconds: 0 } });
    const closed = await rowOf(mon.id);
    assert.equal(closed.status, "stopped");
    assert.equal(closed.stop_reason, "day_rollover");

    // What the route then does: open today's session seeded with the running total, and the
    // agent keeps syncing its running total - half an hour more.
    const next = await svc.createPgSession({
      id: sid(), memberId: m, taskId: rolled.taskId, projectId: P, status: "active",
      startedAt: tue, endedAt: null, activeSeconds: rolled.totals.activeSeconds, idleSeconds: rolled.totals.idleSeconds,
      source: "agent", updatedAt: tue,
    });
    await sync(next.id, 3600 + 1800);

    assert.equal(await dayOf("2026-10-12"), 3600, "Monday keeps Monday's hour");
    assert.equal(await dayOf("2026-10-13"), 1800, "Tuesday gets only Tuesday's half hour");
  });

  test("an app slice sits on its session's day, by the project's calendar; without a session, its own time in the member's", async () => {
    const { eventDaySql } = await import(url("lib/postgres/session-day-sql.js"));
    await db.exec(`CREATE TABLE IF NOT EXISTS activity_app_logs (member_id uuid, session_id varchar(128), started_at timestamptz)`);
    const m = await member("Africa/Cairo");
    const ny = "dddddddd-0000-4000-8000-000000000001";
    await db.query("INSERT INTO projects VALUES ($1, 'America/New_York')", [ny]);
    // The session starts 23:00 UTC Oct 9 (Oct 9 in New York); the slice is logged at 01:30 UTC Oct 10,
    // which is Oct 10 in New York and in Cairo - it still belongs to the session's Oct 9.
    const s = await svc.createPgSession({
      id: sid(), memberId: m, taskId: null, projectId: ny, status: "active",
      startedAt: new Date("2026-10-09T23:00:00Z"), endedAt: null, activeSeconds: 0, idleSeconds: 0,
      source: "agent", updatedAt: new Date(),
    });
    await db.query(
      "INSERT INTO activity_app_logs VALUES ($1, $2, '2026-10-10T01:30:00Z'), ($1, 'not-a-session', '2026-10-10T23:30:00Z')",
      [m, s.id],
    );
    const rows = await run(
      `SELECT l.session_id, to_char(${eventDaySql("l", "l.started_at")}, 'YYYY-MM-DD') AS day
       FROM activity_app_logs l WHERE l.member_id = $1 ORDER BY l.started_at`,
      [m],
    );
    assert.deepEqual(rows.map((r) => r.day), ["2026-10-09", "2026-10-11"]); // 23:30 UTC Oct 10 is Oct 11 in Cairo
  });
}
