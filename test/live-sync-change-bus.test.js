// PLAN-livesyncandagenttimer.md §8 - the two runnable checks the plan asks
// to be left behind: (1) a local publishChange must reach subscribeChanges
// exactly once (local-echo de-dup must not double-deliver a message a
// process published to itself), and (2) a conditional write that loses the
// updated_at race returns a conflict instead of silently overwriting.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

test("publishChange -> subscribeChanges fires exactly once for a local publish", async () => {
  const { publishChange, subscribeChanges, resetChangeBusForTests } = await import(
    "../src/modules/realtime/change-bus.js"
  );
  resetChangeBusForTests();

  const received = [];
  const unsubscribe = subscribeChanges((msg) => received.push(msg));
  try {
    await publishChange("projects", "proj-1", "updated", "member-1");
    // publishChange resolves after the local emit (Redis publish, if any, is
    // awaited too, but REDIS_URL is unset here so that branch is a no-op).
    assert.equal(received.length, 1);
    assert.equal(received[0].resource, "projects");
    assert.equal(received[0].id, "proj-1");
    assert.equal(received[0].action, "updated");
    assert.equal(received[0].actor, "member-1");
  } finally {
    unsubscribe();
    resetChangeBusForTests();
  }
});

test("updateProjectPg returns a conflict, without mutating the row, when updated_at no longer matches", async () => {
  /** @type {{ rows: Record<string, unknown>[] }} */
  const stub = { rows: [] };

  const real = await import("../src/lib/postgres/client.js");
  mock.module("../src/lib/postgres/client.js", {
    namedExports: {
      ...real,
      // The conditional UPDATE's WHERE (id = $1 AND updated_at = $expected)
      // matched nothing - simulating another writer having landed first.
      query: async (sql) => (String(sql).includes("UPDATE projects") ? [] : stub.rows),
    },
  });

  const { updateProjectPg } = await import("../src/lib/postgres/projects-postgres.service.js");

  const result = await updateProjectPg("proj-1", { name: "Renamed" }, "2024-01-01T00:00:00.000Z");
  assert.equal(result.conflict, true);
  // No row came back from the (mocked) UPDATE, so nothing was mutated.
  assert.equal(result.current, null);
});
