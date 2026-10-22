// The abandoned-session sweep closes any agent session whose `updated_at` is
// over five minutes old, and only a *sync* POST moved that column. The agent's
// session poll - every few seconds, for every session - moved nothing, so a
// live agent whose syncs stopped landing for five minutes had its session
// closed underneath it. The timer stopped on its own: no idle, no warning,
// 100% activity and a stopped clock.
//
// What a touch changes (updated_at only, open sessions only) is checked on real rows in
// session-rows.pglite.test.js; this file keeps the input guard.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const calls = { sql: [], params: [] };
let nextRowCount = 1;

// activity-events-postgres.service.js's local pgQuery delegates to
// client.js's queryRaw, which returns the raw pg result.
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    queryRaw: async (sql, params) => {
      calls.sql.push(sql);
      calls.params.push(params);
      return { rowCount: nextRowCount, rows: [] };
    },
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    query: async () => [],
  },
});

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

const { touchPgSessionActivity } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

test("a malformed session id never reaches the database", async () => {
  const before = calls.sql.length;
  assert.equal(await touchPgSessionActivity("not-a-uuid"), false);
  assert.equal(await touchPgSessionActivity(""), false);
  assert.equal(await touchPgSessionActivity(null), false);
  assert.equal(calls.sql.length, before, "no query should have been issued");
});
