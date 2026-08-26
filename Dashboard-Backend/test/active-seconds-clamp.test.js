// Guards TC-4: active_seconds/idle_seconds must never be silently overwritten
// downward. Two devices racing on the same session/task, or a slow request
// landing after a later one, used to destroy recorded time with no trace.
// The one legitimate exception is the desktop agent's idle-escalation
// rewind, posted as action "stop" - that reversal must still work.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ rows: any[] }[]} */
let responses = [];
/** @type {{ sql: string, params: any[] }[]} */
let calls = [];

function fakeClient() {
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      const next = responses.shift();
      return next ?? { rows: [] };
    },
    release: () => {},
  };
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    // activity-events-postgres.service.js drives its own client.query() via
    // getPostgresPool().connect() (pgQuery, module-local).
    getPostgresPool: () => ({ connect: async () => fakeClient() }),
    // task-member-progress.service.js instead calls the higher-level query()
    // helper directly - both exports route through the same fake so one
    // `calls`/`responses` pair backs both files under test.
    query: async (sql, params) => {
      calls.push({ sql, params });
      const next = responses.shift();
      return next?.rows ?? [];
    },
    __closePostgresPoolForTests: async () => null,
    isPostgresConfigured: () => true,
    probePostgresReadiness: async () => null,
    withTransaction: async () => null,
  },
});
mock.module("../src/http/sanitize-error.js", {
  namedExports: { logSafeWarn: () => {}, logSafeError: () => {},
    formatErrorForLog: async () => null,
    sanitizeErrorMessage: async () => null,
  },
});

const { updatePgSession } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);
const { upsertTrackingRowPg } = await import(
  "../src/lib/postgres/task-member-progress.service.js"
);

function reset() {
  responses = [];
  calls = [];
}

// --- updatePgSession (activity_sessions) ---------------------------------

test("sync cannot lower active_seconds below what is stored", async () => {
  reset();
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", active_seconds: 1000, idle_seconds: 50 }],
  }); // prev-read
  responses.push({ rows: [] }); // rollup delta insert(s), if any
  responses.push({ rows: [] }); // final UPDATE

  await updatePgSession("session-1", { activeSeconds: 800, updatedAt: new Date() });

  const updateCall = calls.find((c) => c.sql.includes("UPDATE activity_sessions"));
  assert.ok(updateCall, "expected an UPDATE activity_sessions call");
  // sessionId is always params[0]; active_seconds is the next param since
  // it's the only other field in this patch.
  assert.equal(updateCall.params[1], 1000, "clamped to the stored value, not the lower incoming one");
});

test("stop (allowDecrease) can lower active_seconds — the idle rewind must still work", async () => {
  reset();
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", active_seconds: 1000, idle_seconds: 50 }],
  });
  responses.push({ rows: [] });
  responses.push({ rows: [] });

  await updatePgSession(
    "session-1",
    { status: "stopped", activeSeconds: 940, updatedAt: new Date() },
    { allowDecrease: true },
  );

  const updateCall = calls.find((c) => c.sql.includes("UPDATE activity_sessions"));
  assert.ok(updateCall.params.includes(940), "the rewound (lower) value must be written verbatim");
});

test("a higher sync value is always written, clamp or not", async () => {
  reset();
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", active_seconds: 1000, idle_seconds: 50 }],
  });
  responses.push({ rows: [] });

  await updatePgSession("session-1", { activeSeconds: 1200, updatedAt: new Date() });

  const updateCall = calls.find((c) => c.sql.includes("UPDATE activity_sessions"));
  assert.ok(updateCall.params.includes(1200));
});

test("idle_seconds is always clamped up, even on a stop action", async () => {
  reset();
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", active_seconds: 1000, idle_seconds: 300 }],
  });
  responses.push({ rows: [] });

  await updatePgSession(
    "session-1",
    { status: "stopped", idleSeconds: 100, updatedAt: new Date() },
    { allowDecrease: true },
  );

  const updateCall = calls.find((c) => c.sql.includes("UPDATE activity_sessions"));
  assert.ok(
    updateCall.params.includes(300),
    "idle_seconds must never regress, even when allowDecrease is set for active_seconds",
  );
});

test("the daily rollup delta reflects the clamped value, not the rejected raw request", async () => {
  reset();
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", active_seconds: 1000, idle_seconds: 0 }],
  });
  responses.push({ rows: [] }); // recordDailyActiveSecondsDelta's member insert
  responses.push({ rows: [] }); // recordDailyActiveSecondsDelta's task insert
  responses.push({ rows: [] }); // final UPDATE

  await updatePgSession("session-1", { activeSeconds: 800, updatedAt: new Date() });

  // A rejected downward write clamps to the stored value (1000), so the
  // delta against the stored value is 0 - no rollup write should fire at all.
  const rollupCalls = calls.filter((c) => c.sql.includes("daily_member_active_seconds"));
  assert.equal(rollupCalls.length, 0, "no delta should be recorded when the write was clamped away");
});

test("CQ-2: a rewind is attributed to the day the session started, not today", async () => {
  reset();
  const startedYesterday = new Date(Date.now() - 25 * 60 * 60 * 1000); // safely > 1 day ago
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", started_at: startedYesterday, active_seconds: 1000, idle_seconds: 0 }],
  });
  responses.push({ rows: [] }); // member rollup insert
  responses.push({ rows: [] }); // task rollup insert
  responses.push({ rows: [] }); // final UPDATE

  // An idle-rewind stop lowering active_seconds - allowDecrease: true.
  await updatePgSession(
    "session-1",
    { status: "stopped", activeSeconds: 940, updatedAt: new Date() },
    { allowDecrease: true },
  );

  const rollupCall = calls.find((c) => c.sql.includes("INSERT INTO daily_member_active_seconds"));
  assert.ok(rollupCall, "expected a rollup delta insert for the rewind");
  const dayParam = rollupCall.params[1];
  assert.equal(
    new Date(dayParam).toDateString(),
    startedYesterday.toDateString(),
    "the delta must land on the day the session started, not the day the rewind happened",
  );
});

test("CQ-2: a missing started_at falls back to today instead of crashing", async () => {
  reset();
  responses.push({
    rows: [{ member_id: "m1", task_id: "t1", active_seconds: 1000, idle_seconds: 0 }], // no started_at
  });
  responses.push({ rows: [] });
  responses.push({ rows: [] });
  responses.push({ rows: [] });

  await updatePgSession(
    "session-1",
    { status: "stopped", activeSeconds: 940, updatedAt: new Date() },
    { allowDecrease: true },
  );

  const rollupCall = calls.find((c) => c.sql.includes("INSERT INTO daily_member_active_seconds"));
  assert.ok(rollupCall, "must still record the delta even without a started_at");
});

// --- upsertTrackingRowPg (task_member_progress) ---------------------------

test("routine sync emits a GREATEST clamp for active_seconds", async () => {
  reset();
  responses.push({ rows: [{ id: "row-1" }] });

  await upsertTrackingRowPg({ task_id: "t1", member_id: "m1", active_seconds: 500, idle_seconds: 0 });

  const insertCall = calls[0];
  assert.match(insertCall.sql, /GREATEST\(task_member_progress\.active_seconds, EXCLUDED\.active_seconds\)/);
});

test("stop (allowDecrease) writes active_seconds unclamped", async () => {
  reset();
  responses.push({ rows: [{ id: "row-1" }] });

  await upsertTrackingRowPg(
    { task_id: "t1", member_id: "m1", active_seconds: 470, idle_seconds: 0 },
    { allowDecrease: true },
  );

  const insertCall = calls[0];
  assert.doesNotMatch(
    insertCall.sql,
    /GREATEST\(task_member_progress\.active_seconds/,
    "stop must be able to write a lower active_seconds directly",
  );
});

test("idle_seconds always clamps up, even on stop", async () => {
  reset();
  responses.push({ rows: [{ id: "row-1" }] });

  await upsertTrackingRowPg(
    { task_id: "t1", member_id: "m1", active_seconds: 470, idle_seconds: 10 },
    { allowDecrease: true },
  );

  const insertCall = calls[0];
  assert.match(insertCall.sql, /GREATEST\(task_member_progress\.idle_seconds, EXCLUDED\.idle_seconds\)/);
});
