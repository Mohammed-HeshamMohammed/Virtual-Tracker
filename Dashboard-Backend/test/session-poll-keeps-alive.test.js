// The abandoned-session sweep closes any agent session whose `updated_at` is
// over five minutes old, and only a *sync* POST moved that column. The agent's
// session poll - every few seconds, for every session - moved nothing, so a
// live agent whose syncs stopped landing for five minutes had its session
// closed underneath it. The timer stopped on its own: no idle, no warning,
// 100% activity and a stopped clock.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const calls = { sql: [], params: [] };
let nextRowCount = 1;

// The service talks to Postgres through a pool it gets from client.js, so the
// pool is what has to be stubbed - there is no separate query module to mock.
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    getPostgresPool: () => ({
      connect: async () => ({
        query: async (sql, params) => {
          calls.sql.push(sql);
          calls.params.push(params);
          return { rowCount: nextRowCount, rows: [] };
        },
        release: () => {},
      }),
    }),
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    query: async () => [],
  },
});

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

const { touchPgSessionActivity } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

test("touching a session moves only its updated_at", async () => {
  await touchPgSessionActivity(SESSION_ID);
  const sql = calls.sql.at(-1) ?? "";
  assert.match(sql, /UPDATE activity_sessions SET updated_at = now\(\)/);
  // Nothing else may move: this runs on every poll and must never be able to
  // rewrite a session's recorded seconds or status.
  assert.doesNotMatch(sql, /active_seconds|idle_seconds|status\s*=/);
  assert.deepEqual(calls.params.at(-1), [SESSION_ID]);
});

// A session that was legitimately stopped must stay stopped - a poll arriving
// late must not resurrect it.
test("only an open session can be touched", async () => {
  await touchPgSessionActivity(SESSION_ID);
  assert.match(calls.sql.at(-1) ?? "", /status IN \('active', 'idle'\)/);
});

test("a malformed session id never reaches the database", async () => {
  const before = calls.sql.length;
  assert.equal(await touchPgSessionActivity("not-a-uuid"), false);
  assert.equal(await touchPgSessionActivity(""), false);
  assert.equal(await touchPgSessionActivity(null), false);
  assert.equal(calls.sql.length, before, "no query should have been issued");
});
