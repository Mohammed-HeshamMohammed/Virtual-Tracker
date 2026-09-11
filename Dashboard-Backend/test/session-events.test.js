// "My timer stopped by itself" used to be answered by reading code and guessing
// which of twenty paths fired. Session history makes it a query. These pin
// what gets written, and that writing it can never break the session action
// it describes.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const calls = [];
const behaviour = { failInserts: false };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    getPostgresPool: () => ({
      connect: async () => ({
        query: async (sql, params) => {
          if (behaviour.failInserts && /INSERT INTO activity_session_events/.test(sql)) {
            throw new Error('relation "activity_session_events" does not exist');
          }
          calls.push({ sql, params });
          return { rowCount: 1, rows: [] };
        },
        release: () => {},
      }),
    }),
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    query: async () => [],
  },
});

const { recordSessionEventPg, updatePgSession } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

const SESSION = "11111111-2222-4333-8444-555555555555";
const ACTOR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test.beforeEach(() => {
  calls.length = 0;
  behaviour.failInserts = false;
});

test("an event records what happened, why, who and from where", async () => {
  await recordSessionEventPg({
    sessionId: SESSION,
    action: "stop",
    reason: "idle_escalation",
    actorId: ACTOR,
    source: "agent",
    clientVersion: "1.0.5",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO activity_session_events/);
  assert.deepEqual(calls[0].params, [SESSION, "stop", "idle_escalation", ACTOR, "agent", "1.0.5"]);
});

// The member comes from the session row, so no caller can attribute an event
// to the wrong person.
test("the member is taken from the session itself", async () => {
  await recordSessionEventPg({ sessionId: SESSION, action: "idle" });
  assert.match(calls[0].sql, /SELECT \$1, member_id, .* FROM activity_sessions WHERE id = \$1/s);
});

test("an event with no reason is recorded as unspecified, from the server", async () => {
  await recordSessionEventPg({ sessionId: SESSION, action: "stop" });
  assert.deepEqual(calls[0].params, [SESSION, "stop", "unspecified", null, "server", null]);
});

// History is best-effort. A missing table or a failed write must never be the
// reason a pause or stop fails.
test("a failed history write is swallowed, never thrown", async () => {
  behaviour.failInserts = true;
  await assert.doesNotReject(recordSessionEventPg({ sessionId: SESSION, action: "stop" }));
});

test("a malformed session id writes nothing", async () => {
  await recordSessionEventPg({ sessionId: "not-a-uuid", action: "stop" });
  await recordSessionEventPg({ sessionId: SESSION, action: "" });
  assert.equal(calls.length, 0);
});

test("a stop records its reason and who stopped it on the session row", async () => {
  await updatePgSession(SESSION, { status: "stopped", stopReason: "member_stop", stoppedBy: ACTOR });
  const update = calls.find((c) => /UPDATE activity_sessions SET/.test(c.sql));
  assert.ok(update, "the session row was updated");
  assert.match(update.sql, /stop_reason = \$\d+/);
  assert.match(update.sql, /stopped_by = \$\d+/);
  assert.ok(update.params.includes("member_stop"));
  assert.ok(update.params.includes(ACTOR));
});

test("a pause records its reason and when it happened", async () => {
  const at = new Date("2026-09-11T10:00:00Z");
  await updatePgSession(SESSION, { status: "idle", pauseReason: "member_pause", pausedAt: at });
  const update = calls.find((c) => /UPDATE activity_sessions SET/.test(c.sql));
  assert.match(update.sql, /pause_reason = \$\d+/);
  assert.match(update.sql, /paused_at = \$\d+/);
  assert.ok(update.params.includes("member_pause"));
  assert.ok(update.params.includes(at));
});

// The reap and similar server-side stops pass their event with the update, so
// the row and its history can never disagree.
test("an update carrying an event writes the history row after the update", async () => {
  await updatePgSession(SESSION, {
    status: "stopped",
    stopReason: "abandoned_reap",
    event: { action: "stop", reason: "abandoned_reap", source: "server" },
  });
  const updateAt = calls.findIndex((c) => /UPDATE activity_sessions SET/.test(c.sql));
  const insertAt = calls.findIndex((c) => /INSERT INTO activity_session_events/.test(c.sql));
  assert.ok(updateAt >= 0 && insertAt > updateAt, "history is written after the row it describes");
  assert.deepEqual(calls[insertAt].params, [SESSION, "stop", "abandoned_reap", null, "server", null]);
});
