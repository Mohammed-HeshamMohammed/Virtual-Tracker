// Deleting a project alone cascades activity_sessions, tasks, project_members
// etc. (see ensure-lookup-schema.js's cascadeOnDelete) - but a calling/support
// project's sessions have no task, so their screenshots/app-logs/url-logs are
// linked only by session_id, a VARCHAR matched against activity_sessions.id
// by cast rather than a real foreign key. deleteProjectPg has to clean those
// up itself, by session_id, before the project (and its sessions) are gone -
// this is the one part of "delete a project -> everything related to it
// disappears" that a DB-level cascade cannot reach.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ sessionRows: { id: string }[], calls: { sql: string, params: any[] }[] }} */
const stub = { sessionRows: [], calls: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      stub.calls.push({ sql, params });
      if (sql.includes("SELECT id FROM activity_sessions WHERE project_id")) return stub.sessionRows;
      return [];
    },
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
    withTransaction: async (fn) => fn({ query: async () => [] }),
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
  },
});

mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: { getSingleByMemberId: async () => null },
});
mock.module("../src/lib/postgres/clients-postgres.service.js", {
  namedExports: { getClientBudgetPg: async () => null },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => {} },
});
mock.module("../src/modules/projects/management-rollup.service.js", {
  namedExports: { syncManagementParentsOfProject: async () => {} },
});

const { deleteProjectPg } = await import("../src/lib/postgres/projects-postgres.service.js");

function reset({ sessionRows = [] } = {}) {
  stub.sessionRows = sessionRows;
  stub.calls = [];
}

function callsMatching(substring) {
  return stub.calls.filter((c) => c.sql.includes(substring));
}

test("a project with no sessions deletes cleanly with no screenshot/log cleanup queries", async () => {
  reset({ sessionRows: [] });
  await deleteProjectPg("p1", "actor1");
  assert.equal(callsMatching("DELETE FROM activity_screenshots").length, 0);
  assert.equal(callsMatching("DELETE FROM activity_app_logs").length, 0);
  assert.equal(callsMatching("DELETE FROM activity_url_logs").length, 0);
  assert.equal(callsMatching("DELETE FROM projects").length, 1);
});

test("a project's sessions are looked up and their screenshots/app-logs/url-logs are removed by session_id before the project itself is deleted", async () => {
  reset({ sessionRows: [{ id: "s1" }, { id: "s2" }] });
  await deleteProjectPg("p2", "actor1");

  const screenshotCalls = callsMatching("DELETE FROM activity_screenshots");
  assert.equal(screenshotCalls.length, 1);
  assert.deepEqual(screenshotCalls[0].params, [["s1", "s2"]]);

  const appLogCalls = callsMatching("DELETE FROM activity_app_logs");
  assert.equal(appLogCalls.length, 1);
  assert.deepEqual(appLogCalls[0].params, [["s1", "s2"]]);

  const urlLogCalls = callsMatching("DELETE FROM activity_url_logs");
  assert.equal(urlLogCalls.length, 1);
  assert.deepEqual(urlLogCalls[0].params, [["s1", "s2"]]);

  // Order matters: the session lookup and the screenshot/log cleanup must
  // both happen before the project row (and its cascaded sessions) are gone,
  // or there would be nothing left to look up.
  const sessionLookupIndex = stub.calls.findIndex((c) => c.sql.includes("SELECT id FROM activity_sessions"));
  const projectDeleteIndex = stub.calls.findIndex((c) => c.sql.includes("DELETE FROM projects"));
  assert.ok(sessionLookupIndex >= 0 && sessionLookupIndex < projectDeleteIndex);
  for (const call of [...screenshotCalls, ...appLogCalls, ...urlLogCalls]) {
    assert.ok(stub.calls.indexOf(call) < projectDeleteIndex);
  }
});

test("session ids are converted to strings before being used as the session_id match", async () => {
  // activity_sessions.id is UUID; activity_screenshots.session_id etc. are
  // VARCHAR - the match only works if these are passed as text, not left as
  // whatever object shape the driver returned the uuid column as.
  reset({ sessionRows: [{ id: "s1" }] });
  await deleteProjectPg("p3");
  const screenshotCalls = callsMatching("DELETE FROM activity_screenshots");
  assert.deepEqual(screenshotCalls[0].params, [["s1"]]);
  assert.equal(typeof screenshotCalls[0].params[0][0], "string");
});
