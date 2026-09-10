// A project's screenshots and app-time can come from either a task-based
// session (project resolved via the task) or a task-less/calling one
// (resolved via the session itself) - these guard that both routes into a
// project are actually reachable, not just the task-based one, and that the
// SQL/params built for each are shaped the way the query() mock below can
// verify without a real database.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const MEMBER_ID = "11111111-1111-1111-8111-111111111111";
const PROJECT_ID = "22222222-2222-2222-8222-222222222222";

/** @type {{ sql: string, params: unknown[] } | null} */
let lastCall = null;
/** @type {Record<string, unknown>[]} */
let nextRows = [];

// activity-events-postgres.service.js bypasses client.js's own query() export
// entirely - it calls getPostgresPool() and drives client.connect()/query()/
// release() itself, so the pool/client have to be faked at that level, not
// by mocking a query() this module never calls.
mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    getPostgresPool: () => ({
      connect: async () => ({
        query: async (sql, params) => {
          lastCall = { sql, params };
          return { rows: nextRows };
        },
        release: () => {},
      }),
    }),
    query: async () => [],
    __closePostgresPoolForTests: async () => null,
    isPostgresConfigured: () => true,
    probePostgresReadiness: async () => null,
    withTransaction: async () => null,
  },
});

const { fetchPgScreenshots, sumAppLogSecondsByAppNameForProjectPg } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

test("fetchPgScreenshots with a projectId filters on either the task's project or the session's own", async () => {
  nextRows = [];
  await fetchPgScreenshots([MEMBER_ID], null, 12, { projectId: PROJECT_ID });
  assert.match(lastCall.sql, /t\.project_id = \$\d+ OR s\.project_id = \$\d+/);
  assert.ok(lastCall.params.includes(PROJECT_ID), "projectId must be a bound param, not inlined");
});

test("fetchPgScreenshots without a projectId has no project filter in the WHERE clause", async () => {
  nextRows = [];
  await fetchPgScreenshots([MEMBER_ID], null, 12);
  // The joins themselves always reference project_id (that's how project_name
  // resolves); only the WHERE-clause filter is conditional on options.projectId.
  assert.doesNotMatch(lastCall.sql, /t\.project_id = \$\d+ OR s\.project_id = \$\d+/);
});

test("sumAppLogSecondsByAppNameForProjectPg resolves a task-less session's project via the session itself", async () => {
  nextRows = [{ app_name: "Zoom", total_seconds: "1800", all_apps_seconds: "5400", app_count: 4 }];
  const result = await sumAppLogSecondsByAppNameForProjectPg(
    MEMBER_ID,
    PROJECT_ID,
    { fromDay: "2024-01-01", toDay: "2024-01-07" },
  );
  assert.match(lastCall.sql, /LEFT JOIN activity_sessions s ON s\.id::text = l\.session_id/);
  assert.match(lastCall.sql, /t\.project_id = \$4 OR s\.project_id = \$4/);
  assert.deepEqual(lastCall.params, [MEMBER_ID, "2024-01-01", "2024-01-07", PROJECT_ID, 5]);
  assert.deepEqual(result.apps, [{ app_name: "Zoom", total_seconds: "1800", all_apps_seconds: "5400", app_count: 4 }]);
  // The panel shows a handful of apps and needs to say what it is showing a
  // handful *of* - without these its times visibly failed to add up to the
  // tracked week beside them.
  assert.equal(result.totalSeconds, 5400);
  assert.equal(result.appCount, 4);
});

// The caller resolves the week in the member's own timezone; this used to cast
// `started_at::date`, which is the database session's zone, so the two were
// measuring different weeks for anyone not on UTC.
test("sumAppLogSecondsByAppNameForProjectPg buckets days in the member's timezone", async () => {
  nextRows = [];
  await sumAppLogSecondsByAppNameForProjectPg(MEMBER_ID, PROJECT_ID, {
    fromDay: "2024-01-01",
    toDay: "2024-01-07",
  });
  assert.match(lastCall.sql, /AT TIME ZONE COALESCE\(NULLIF\(m_tz\.timezone/);
  assert.doesNotMatch(lastCall.sql, /l\.started_at::date/);
});

test("sumAppLogSecondsByAppNameForProjectPg orders by time descending and honors a custom limit", async () => {
  nextRows = [];
  await sumAppLogSecondsByAppNameForProjectPg(
    MEMBER_ID,
    PROJECT_ID,
    { fromDay: "2024-01-01", toDay: "2024-01-07" },
    3,
  );
  assert.match(lastCall.sql, /ORDER BY total_seconds DESC/);
  assert.equal(lastCall.params.at(-1), 3);
});

test("sumAppLogSecondsByAppNameForProjectPg short-circuits on a malformed member id or a missing project, no query at all", async () => {
  lastCall = null;
  const badMember = await sumAppLogSecondsByAppNameForProjectPg("not-a-uuid", PROJECT_ID, {
    fromDay: "2024-01-01",
    toDay: "2024-01-07",
  });
  assert.deepEqual(badMember, { apps: [], totalSeconds: 0, appCount: 0 });
  assert.equal(lastCall, null, "must not query the database with an unusable member id");

  const noProject = await sumAppLogSecondsByAppNameForProjectPg(MEMBER_ID, "", {
    fromDay: "2024-01-01",
    toDay: "2024-01-07",
  });
  assert.deepEqual(noProject, { apps: [], totalSeconds: 0, appCount: 0 });
  assert.equal(lastCall, null);
});
