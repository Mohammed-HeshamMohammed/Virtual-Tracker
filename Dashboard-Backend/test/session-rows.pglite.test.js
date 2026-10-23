// What session writes leave in the database: the history of a session, the stop and pause fields
// on its row, the poll that keeps it alive, and the one-open-session-per-member rule. Run against a
// real Postgres (PGlite) built from the boot schema.
//
// Replaces SQL-text and source-text checks in session-events, session-poll-keeps-alive and
// one-open-session. Skips itself when PGlite is missing.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startPglite, seeder, srcUrl, loadPglite } from "./helpers/pglite.js";

if (!(await loadPglite())) {
  test("session rows against real Postgres (skipped: @electric-sql/pglite is not installed)", { skip: true }, () => {});
} else {
  const pg = await startPglite();
  after(() => pg.close());
  const { insert, member } = seeder(pg);
  const events = await import(srcUrl("lib/postgres/activity-events-postgres.service.js"));
  const { isOneOpenSessionConflict } = await import(srcUrl("modules/activity/routes.js"));
  const { ensurePostgresLookupSchema } = await import(srcUrl("lib/postgres/ensure-lookup-schema.js"));

  const actor = await member("Manager");
  const session = async (status = "active", extra = {}) => {
    const m = await member("Employee");
    const s = await insert("activity_sessions", {
      member_id: m.id, status, started_at: "2026-09-11T09:00:00Z", active_seconds: 600, idle_seconds: 30,
      updated_at: "2026-09-11T09:30:00Z", ...(status === "stopped" ? { ended_at: "2026-09-11T10:00:00Z" } : {}), ...extra,
    });
    return { ...s, memberId: m.id };
  };
  const row = async (id) => (await pg.rows("SELECT * FROM activity_sessions WHERE id = $1", [id]))[0];
  const history = async (id) =>
    pg.rows("SELECT member_id, action, reason, actor_id, source, client_version FROM activity_session_events WHERE session_id = $1 ORDER BY created_at", [id]);

  test("an event records what happened, why, who, from where, and the session's own member", async () => {
    const s = await session();
    await events.recordSessionEventPg({ sessionId: s.id, action: "stop", reason: "idle_escalation", actorId: actor.id, source: "agent", clientVersion: "1.0.5" });
    assert.deepEqual(await history(s.id), [
      { member_id: s.memberId, action: "stop", reason: "idle_escalation", actor_id: actor.id, source: "agent", client_version: "1.0.5" },
    ]);
  });

  test("an event with no reason is recorded as unspecified, from the server", async () => {
    const s = await session();
    await events.recordSessionEventPg({ sessionId: s.id, action: "idle" });
    const [e] = await history(s.id);
    assert.equal(e.reason, "unspecified");
    assert.equal(e.source, "server");
    assert.equal(e.actor_id, null);
    // Callers pass along whatever they were given, including nothing at all.
    const t = await session();
    await events.recordSessionEventPg({ sessionId: t.id, action: "stop", reason: null, source: "" });
    assert.deepEqual((await history(t.id)).map((x) => [x.reason, x.source]), [["unspecified", "server"]]);
  });

  test("an event for a session that does not exist, a malformed id or no action writes nothing", async () => {
    const missing = "11111111-2222-4333-8444-555555555555";
    await events.recordSessionEventPg({ sessionId: missing, action: "stop" });
    assert.deepEqual(await history(missing), []);
    const s = await session();
    await events.recordSessionEventPg({ sessionId: s.id, action: "" });
    await events.recordSessionEventPg({ sessionId: "not-a-uuid", action: "stop" });
    assert.deepEqual(await history(s.id), []);
    assert.equal((await pg.rows("SELECT count(*)::int AS n FROM activity_session_events WHERE session_id = $1", [s.id]))[0].n, 0);
  });

  test("a stop keeps its reason and who stopped it on the session row", async () => {
    const s = await session();
    await events.updatePgSession(s.id, { status: "stopped", stopReason: "member_stop", stoppedBy: actor.id });
    const r = await row(s.id);
    assert.equal(r.status, "stopped");
    assert.equal(r.stop_reason, "member_stop");
    assert.equal(r.stopped_by, actor.id);
  });

  test("a pause keeps its reason and when it happened", async () => {
    const s = await session();
    const at = new Date("2026-09-11T10:00:00Z");
    await events.updatePgSession(s.id, { status: "idle", pauseReason: "member_pause", pausedAt: at });
    const r = await row(s.id);
    assert.equal(r.pause_reason, "member_pause");
    assert.equal(new Date(r.paused_at).toISOString(), at.toISOString());
  });

  test("an update carrying an event leaves the row and its history in agreement", async () => {
    const s = await session();
    await events.updatePgSession(s.id, { status: "stopped", stopReason: "abandoned_reap", event: { action: "stop", reason: "abandoned_reap", source: "server" } });
    assert.equal((await row(s.id)).stop_reason, "abandoned_reap");
    assert.deepEqual((await history(s.id)).map((e) => [e.action, e.reason, e.source]), [["stop", "abandoned_reap", "server"]]);
  });

  test("the poll moves an open session's updated_at and nothing else", async () => {
    const s = await session("active");
    const before = await row(s.id);
    assert.equal(await events.touchPgSessionActivity(s.id), true);
    const afterTouch = await row(s.id);
    assert.ok(new Date(afterTouch.updated_at) > new Date(before.updated_at));
    for (const k of ["status", "active_seconds", "idle_seconds", "ended_at", "started_at"]) {
      assert.deepEqual(afterTouch[k], before[k], k);
    }
  });

  test("the poll cannot touch a stopped session", async () => {
    const s = await session("stopped");
    const before = await row(s.id);
    assert.equal(await events.touchPgSessionActivity(s.id), false);
    assert.deepEqual(await row(s.id), before);
  });

  test("a member cannot have two open sessions, idle counting as open, and the conflict is recognised", async () => {
    const s = await session("idle");
    await assert.rejects(
      insert("activity_sessions", { member_id: s.memberId, status: "active", started_at: "2026-09-11T11:00:00Z" }),
      (err) => isOneOpenSessionConflict(err),
    );
    // A closed one alongside it is fine.
    await insert("activity_sessions", { member_id: s.memberId, status: "stopped", started_at: "2026-09-10T09:00:00Z", ended_at: "2026-09-10T10:00:00Z" });
  });

  test("booting over old data with duplicate open sessions closes the extras instead of failing", async () => {
    await pg.rows("DROP INDEX activity_sessions_one_open_per_member");
    const m = await member("Employee");
    for (const startedAt of ["2026-09-01T09:00:00Z", "2026-09-02T09:00:00Z", "2026-09-03T09:00:00Z"]) {
      await insert("activity_sessions", { member_id: m.id, status: "active", started_at: startedAt });
    }
    const boot = await ensurePostgresLookupSchema();
    assert.equal(boot.ok, true, boot.error);
    const open = await pg.rows("SELECT id FROM activity_sessions WHERE member_id = $1 AND ended_at IS NULL", [m.id]);
    assert.equal(open.length, 1);
    const [index] = await pg.rows("SELECT indexdef FROM pg_indexes WHERE indexname = 'activity_sessions_one_open_per_member'");
    assert.ok(index, "the index is back");
    assert.equal((await ensurePostgresLookupSchema()).ok, true, "and booting again is harmless");
  });

  test("a failed history write never fails the action it describes", async () => {
    const s = await session();
    await pg.rows("ALTER TABLE activity_session_events RENAME TO activity_session_events_gone");
    try {
      await assert.doesNotReject(events.recordSessionEventPg({ sessionId: s.id, action: "stop" }));
      await events.updatePgSession(s.id, { status: "stopped", stopReason: "member_stop", event: { action: "stop" } });
      assert.equal((await row(s.id)).status, "stopped");
    } finally {
      await pg.rows("ALTER TABLE activity_session_events_gone RENAME TO activity_session_events");
    }
  });
}
