// Deleting a project deletes everything that belongs to it - tasks and their
// children, work sessions and everything captured in them, time entries,
// progress, and the project's own links - in one transaction. It used to delete
// the project row and a few session logs, relying on database cascades that an
// older production schema didn't have, so the delete failed with a 500.
//
// What it must keep: the apps and sites catalog and their classifications
// (they hold only an app or site and what it is, not how a project used it),
// and invoices and expenses, which just stop pointing at the project.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const state = { tasks: [], sessions: [], members: [], parents: [], failOn: null };
const txCalls = [];
const plainCalls = [];
const published = [];
const rolledUp = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      plainCalls.push({ sql, params });
      return [];
    },
    withTransaction: async (fn) =>
      fn({
        query: async (sql, params = []) => {
          const text = sql.replace(/\s+/g, " ").trim();
          txCalls.push({ sql: text, params });
          if (state.failOn && text.includes(state.failOn)) throw new Error(`boom: ${state.failOn}`);
          if (text.startsWith("SELECT id FROM tasks")) return { rows: state.tasks.map((id) => ({ id })) };
          if (text.startsWith("SELECT id FROM activity_sessions")) return { rows: state.sessions.map((id) => ({ id })) };
          if (text.startsWith("SELECT DISTINCT member_id")) {
            return { rows: state.members.map((member_id) => ({ member_id })) };
          }
          if (text.startsWith("SELECT parent_project_id")) {
            return { rows: state.parents.map((parent_project_id) => ({ parent_project_id })) };
          }
          return { rows: [] };
        },
      }),
    isPostgresConfigured: () => true,
    getPostgresPool: () => null,
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
  namedExports: {
    publishChange: async (...args) => {
      published.push(args);
    },
  },
});
mock.module("../src/modules/projects/management-rollup.service.js", {
  namedExports: {
    syncManagementParentsOfProject: async () => {},
    syncManagementProjectMembers: async (parentId) => {
      rolledUp.push(parentId);
    },
  },
});

const { deleteProjectPg } = await import("../src/lib/postgres/projects-postgres.service.js");

function reset(next = {}) {
  Object.assign(state, { tasks: [], sessions: [], members: [], parents: [], failOn: null }, next);
  txCalls.length = 0;
  plainCalls.length = 0;
  published.length = 0;
  rolledUp.length = 0;
}
const indexOf = (fragment) => txCalls.findIndex((c) => c.sql.includes(fragment));
const callFor = (fragment) => txCalls.find((c) => c.sql.includes(fragment));

test("everything runs in one transaction - nothing outside it", async () => {
  reset({ tasks: ["t1"], sessions: ["s1"] });
  await deleteProjectPg(PROJECT, "actor");
  assert.ok(txCalls.length > 0);
  assert.equal(plainCalls.length, 0);
});

test("sessions are found by the project and by any of its tasks", async () => {
  reset({ tasks: ["t1", "t2"] });
  await deleteProjectPg(PROJECT, "actor");
  const lookup = callFor("SELECT id FROM activity_sessions");
  assert.match(lookup.sql, /project_id = \$1 OR task_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(lookup.params, [PROJECT, ["t1", "t2"]]);
});

test("everything captured in its sessions is deleted, by session and by task", async () => {
  reset({ tasks: ["t1"], sessions: ["s1", "s2"] });
  await deleteProjectPg(PROJECT, "actor");
  for (const table of ["activity_screenshots", "activity_app_logs", "activity_url_logs"]) {
    const call = callFor(`DELETE FROM ${table} `);
    assert.ok(call, `${table} is cleared`);
    assert.deepEqual(call.params, [["s1", "s2"], ["t1"]]);
    assert.equal(typeof call.params[0][0], "string", "session_id is text on these tables");
  }
  for (const fragment of [
    "DELETE FROM screenshot_access_log",
    "DELETE FROM activity_integrity_flags",
    "DELETE FROM activity_session_events",
    "DELETE FROM activity_sessions",
  ]) {
    assert.ok(callFor(fragment), fragment);
  }
});

test("time, progress, tasks and every child of a task are deleted", async () => {
  reset({ tasks: ["t1"] });
  await deleteProjectPg(PROJECT, "actor");
  for (const fragment of [
    "DELETE FROM time_entries",
    "DELETE FROM task_member_progress",
    "DELETE FROM daily_member_task_active_seconds",
    "DELETE FROM task_assignments",
    "DELETE FROM task_comments",
    "DELETE FROM task_subtasks",
    "DELETE FROM task_attachments",
    "DELETE FROM task_hours",
    "DELETE FROM tasks",
  ]) {
    assert.ok(callFor(fragment), fragment);
  }
});

test("the project's own links go, and the project last", async () => {
  reset();
  await deleteProjectPg(PROJECT, "actor");
  for (const table of [
    "project_member_limits",
    "project_members",
    "project_budget_notify_state",
    "project_budgets",
    "client_projects",
    "team_projects",
    "invite_projects",
    "pending_auth_projects",
    "project_subprojects",
  ]) {
    assert.ok(callFor(`DELETE FROM ${table} `), table);
  }
  assert.equal(indexOf("DELETE FROM projects "), txCalls.length - 1, "the project row is the very last statement");
});

test("children always go before what they belong to", async () => {
  reset({ tasks: ["t1"], sessions: ["s1"] });
  await deleteProjectPg(PROJECT, "actor");
  const before = (a, b) => assert.ok(indexOf(a) < indexOf(b), `${a} before ${b}`);
  before("DELETE FROM screenshot_access_log", "DELETE FROM activity_screenshots");
  before("DELETE FROM activity_screenshots", "DELETE FROM activity_sessions");
  before("DELETE FROM activity_session_events", "DELETE FROM activity_sessions");
  before("DELETE FROM task_comments", "DELETE FROM tasks ");
  before("DELETE FROM tasks ", "DELETE FROM projects ");
  before("DELETE FROM activity_sessions", "DELETE FROM projects ");
});

test("the apps and sites catalog and their classifications are kept", async () => {
  reset({ tasks: ["t1"], sessions: ["s1"] });
  await deleteProjectPg(PROJECT, "actor");
  for (const call of txCalls) {
    assert.doesNotMatch(call.sql, /\b(FROM|UPDATE|INTO)\s+(apps|activity_categories)\b/, call.sql);
  }
});

test("invoices and expenses are kept - they only stop pointing at the project", async () => {
  reset();
  await deleteProjectPg(PROJECT, "actor");
  assert.ok(callFor("UPDATE invoice_line_items SET project_id = NULL"));
  assert.ok(callFor("UPDATE expenses SET project_id = NULL"));
  assert.equal(indexOf("DELETE FROM invoice"), -1);
  assert.equal(indexOf("DELETE FROM expenses"), -1);
});

test("a large project gets a long enough statement timeout", async () => {
  reset();
  await deleteProjectPg(PROJECT, "actor");
  assert.match(txCalls[0].sql, /SET LOCAL statement_timeout/);
});

test("it returns the project's members, and publishes the change once done", async () => {
  reset({ members: ["m1", "m2"] });
  const result = await deleteProjectPg(PROJECT, "actor");
  assert.deepEqual(result, { id: PROJECT, memberIds: ["m1", "m2"] });
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].slice(0, 3), ["projects", PROJECT, "deleted"]);
});

test("a management project that had it as a sub-project recomputes its members", async () => {
  reset({ parents: ["parent-1"] });
  await deleteProjectPg(PROJECT, "actor");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(rolledUp, ["parent-1"]);
});

// withTransaction rolls back on a throw; nothing may be announced as deleted.
test("a failure part way throws and publishes nothing", async () => {
  reset({ tasks: ["t1"], failOn: "DELETE FROM tasks " });
  await assert.rejects(deleteProjectPg(PROJECT, "actor"), /boom/);
  assert.equal(published.length, 0);
  assert.equal(indexOf("DELETE FROM projects "), -1);
});
