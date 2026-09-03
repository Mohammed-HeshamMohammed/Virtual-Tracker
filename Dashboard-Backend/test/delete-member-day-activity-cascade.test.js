// Guards deleteMemberDayActivityWithChildrenPg - the cascade behind "delete
// this day" on the Time & Activity report (DELETE
// /api/reports/time-and-activity/day). Scopes by (member_id, day) directly
// on every table (screenshots/app-logs/url-logs/sessions/entries), not by
// relaying through session_id, and must never touch activity_categories -
// classification is shared org config, not this member's own data.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ queries: Array<{ sql: string, params: unknown[] }>, rowCounts: Record<string, number>, throwOn: string | null }} */
const stub = { queries: [], rowCounts: {}, throwOn: null };

function reset() {
  stub.queries = [];
  stub.rowCounts = {
    activity_screenshots: 4,
    activity_app_logs: 6,
    activity_url_logs: 2,
    activity_sessions: 3,
    time_entries: 1,
  };
  stub.throwOn = null;
}

function tableFor(sql) {
  if (sql.includes("activity_screenshots")) return "activity_screenshots";
  if (sql.includes("activity_app_logs")) return "activity_app_logs";
  if (sql.includes("activity_url_logs")) return "activity_url_logs";
  if (sql.includes("activity_sessions")) return "activity_sessions";
  if (sql.includes("time_entries")) return "time_entries";
  if (sql.includes("activity_categories")) return "activity_categories";
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

const { deleteMemberDayActivityWithChildrenPg } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

const MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const DAY = "2026-09-02";

test("deletes screenshots, app logs, url logs, sessions, and manual entries, all keyed by (member, day)", async () => {
  reset();
  const result = await deleteMemberDayActivityWithChildrenPg(MEMBER_ID, DAY);

  assert.deepEqual(result, { sessions: 3, entries: 1, screenshots: 4, appLogs: 6, urlLogs: 2 });

  const tablesTouched = stub.queries.map((q) => tableFor(q.sql));
  assert.deepEqual(
    tablesTouched.sort(),
    ["activity_app_logs", "activity_screenshots", "activity_sessions", "activity_url_logs", "time_entries"].sort(),
  );
  for (const q of stub.queries) {
    assert.deepEqual(q.params, [MEMBER_ID, DAY]);
  }
});

test("never touches activity_categories - classification survives regardless of what this member's day contained", async () => {
  reset();
  await deleteMemberDayActivityWithChildrenPg(MEMBER_ID, DAY);
  const touchedCategories = stub.queries.some((q) => tableFor(q.sql) === "activity_categories");
  assert.equal(touchedCategories, false);
});

test("each table is scoped by its own real capture-time column, not a shared one", async () => {
  reset();
  await deleteMemberDayActivityWithChildrenPg(MEMBER_ID, DAY);
  const byTable = Object.fromEntries(stub.queries.map((q) => [tableFor(q.sql), q.sql]));
  assert.match(byTable.activity_screenshots, /captured_at::date/);
  assert.match(byTable.activity_app_logs, /started_at::date/);
  assert.match(byTable.activity_url_logs, /visited_at::date/);
  assert.match(byTable.activity_sessions, /started_at::date/);
  assert.match(byTable.time_entries, /\bdate\s*=/);
});

test("a day with no captured activity at all still deletes cleanly (all counts 0)", async () => {
  reset();
  for (const k of Object.keys(stub.rowCounts)) stub.rowCounts[k] = 0;
  const result = await deleteMemberDayActivityWithChildrenPg(MEMBER_ID, DAY);
  assert.deepEqual(result, { sessions: 0, entries: 0, screenshots: 0, appLogs: 0, urlLogs: 0 });
});

test("a failure partway through propagates - withTransaction's rollback is what keeps this atomic", async () => {
  reset();
  stub.throwOn = "activity_sessions";
  await assert.rejects(() => deleteMemberDayActivityWithChildrenPg(MEMBER_ID, DAY), /boom on activity_sessions/);
});
