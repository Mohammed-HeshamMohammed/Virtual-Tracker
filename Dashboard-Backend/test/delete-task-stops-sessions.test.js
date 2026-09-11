// Stopping a deleted task's timer used to be the dashboard's job - a handler in
// its timer runtime that only ran if a tab happened to have that runtime on.
// In practice the timer kept running on a task that no longer existed. The
// server does it now, as part of deleting the task.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const calls = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [];
    },
    getPostgresPool: () => null,
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => {} },
});

const { deleteTaskPg } = await import("../src/lib/postgres/tasks-postgres.service.js");

const TASK = "11111111-2222-4333-8444-555555555555";
const ACTOR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test.beforeEach(() => {
  calls.length = 0;
});

test("a running timer on the task is stopped, with its reason, before the task goes", async () => {
  await deleteTaskPg(TASK, ACTOR);
  assert.equal(calls.length, 2);
  const [stop, del] = calls;
  assert.match(stop.sql, /UPDATE activity_sessions/);
  assert.match(stop.sql, /stop_reason = 'task_deleted'/);
  assert.match(stop.sql, /WHERE task_id = \$1 AND ended_at IS NULL/);
  assert.match(stop.sql, /INSERT INTO activity_session_events/);
  assert.deepEqual(stop.params, [TASK, ACTOR]);
  assert.match(del.sql, /DELETE FROM tasks WHERE id = \$1/);
});

// stopped_by is a UUID column. A non-UUID actor would fail the whole delete,
// so it is recorded as unknown instead.
test("an actor that is not a member id is recorded as unknown, not passed through", async () => {
  await deleteTaskPg(TASK, "system");
  assert.deepEqual(calls[0].params, [TASK, null]);
  await deleteTaskPg(TASK, undefined);
  assert.deepEqual(calls[2].params, [TASK, null]);
});
