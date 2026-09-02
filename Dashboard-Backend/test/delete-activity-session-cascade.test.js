// Guards deleteActivitySessionWithChildrenPg - the cascade behind "delete a
// work session" (DELETE /api/reports/work-sessions/:id). A session's
// screenshots/app-logs/url-logs are linked by session_id (VARCHAR), not a
// real FK to activity_sessions.id (UUID) - see the function's own doc
// comment - so nothing in Postgres cleans these up on its own; this is the
// only thing that does.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ queries: Array<{ sql: string, params: unknown[] }>, rowCounts: Record<string, number>, throwOn: string | null }} */
const stub = { queries: [], rowCounts: {}, throwOn: null };

function reset() {
  stub.queries = [];
  stub.rowCounts = {
    activity_screenshots: 3,
    activity_app_logs: 2,
    activity_url_logs: 1,
    activity_sessions: 1,
  };
  stub.throwOn = null;
}

function tableFor(sql) {
  if (sql.includes("activity_screenshots")) return "activity_screenshots";
  if (sql.includes("activity_app_logs")) return "activity_app_logs";
  if (sql.includes("activity_url_logs")) return "activity_url_logs";
  if (sql.includes("activity_sessions")) return "activity_sessions";
  return "unknown";
}

const fakeClient = {
  query: mock.fn(async (sql, params) => {
    stub.queries.push({ sql, params });
    const table = tableFor(sql);
    if (stub.throwOn === table) throw new Error(`boom on ${table}`);
    return { rowCount: stub.rowCounts[table] ?? 0 };
  }),
};

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    getPostgresPool: () => ({}),
    query: async () => [],
    withTransaction: async (fn) => fn(fakeClient),
  },
});

const { deleteActivitySessionWithChildrenPg } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

const SESSION_ID = "11111111-1111-1111-1111-111111111111";

test("deletes screenshots, app logs, url logs, and the session itself, all keyed by the same id", async () => {
  reset();
  const result = await deleteActivitySessionWithChildrenPg(SESSION_ID);

  assert.deepEqual(result, {
    deletedSession: true,
    screenshots: 3,
    appLogs: 2,
    urlLogs: 1,
  });

  const tablesTouched = stub.queries.map((q) => tableFor(q.sql));
  assert.deepEqual(
    tablesTouched.sort(),
    ["activity_app_logs", "activity_screenshots", "activity_sessions", "activity_url_logs"].sort(),
  );
  // Every child-table delete is keyed by this exact session id.
  for (const q of stub.queries) {
    assert.deepEqual(q.params, [SESSION_ID]);
  }
});

test("a session with no captured activity at all still deletes cleanly (all child counts 0)", async () => {
  reset();
  stub.rowCounts.activity_screenshots = 0;
  stub.rowCounts.activity_app_logs = 0;
  stub.rowCounts.activity_url_logs = 0;

  const result = await deleteActivitySessionWithChildrenPg(SESSION_ID);
  assert.deepEqual(result, { deletedSession: true, screenshots: 0, appLogs: 0, urlLogs: 0 });
});

test("a session id that doesn't exist reports deletedSession: false without throwing", async () => {
  reset();
  stub.rowCounts.activity_sessions = 0;

  const result = await deleteActivitySessionWithChildrenPg(SESSION_ID);
  assert.equal(result.deletedSession, false);
});

test("a failure partway through (e.g. deleting app logs) propagates - withTransaction's own rollback is what keeps this atomic, this just confirms the error isn't swallowed", async () => {
  reset();
  stub.throwOn = "activity_app_logs";

  await assert.rejects(() => deleteActivitySessionWithChildrenPg(SESSION_ID), /boom on activity_app_logs/);
});
