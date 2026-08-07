// Guards ACT-4: the raw ActivityMeter counters (keystrokeCount, distinctKeyCount,
// mouseDistancePx, injectedEventCount, activeSecondsInWindow) must actually reach
// activity_screenshots/activity_app_logs, defaulting to 0 rather than crashing when
// a web-sourced event (or a pre-ACT-4 agent) sends none of it - and a merged
// app-log row must accumulate the signal alongside duration_seconds, not overwrite it.
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
    getPostgresPool: () => ({ connect: async () => fakeClient() }),
    // task-member-progress.service.js (imported transitively for
    // parseProgressUuid) calls the higher-level query() helper directly.
    query: async () => [],
  },
});
mock.module("../src/http/sanitize-error.js", {
  namedExports: { logSafeWarn: () => {}, logSafeError: () => {} },
});

const { insertActivityScreenshot, insertActivityAppLog } = await import(
  "../src/lib/postgres/activity-events-postgres.service.js"
);

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";

function reset() {
  responses = [];
  calls = [];
}

test("a screenshot with no signal at all persists zeros, not a crash", async () => {
  reset();
  await insertActivityScreenshot({
    id: "22222222-2222-2222-2222-222222222222",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "Some Title",
    activityLevel: 42,
    capturedAt: new Date(),
    source: "agent",
  });
  assert.equal(calls.length, 1);
  const params = calls[0].params;
  // The 5 ACT-4 signal columns precede the trailing AC-2 perceptual_hash column.
  assert.deepEqual(params.slice(-6, -1), [0, 0, 0, 0, 0]);
});

test("a screenshot's signal values are persisted exactly, not just defaulted", async () => {
  reset();
  await insertActivityScreenshot({
    id: "33333333-3333-3333-3333-333333333333",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "Some Title",
    activityLevel: 80,
    capturedAt: new Date(),
    source: "agent",
    signal: {
      keystrokeCount: 40,
      distinctKeyCount: 15,
      mouseDistancePx: 1234,
      injectedEventCount: 2,
      activeSecondsInWindow: 58,
    },
  });
  const params = calls[0].params;
  assert.deepEqual(params.slice(-6, -1), [40, 15, 1234, 2, 58]);
});

test("a negative or non-numeric signal field is clamped to 0, not rejected", async () => {
  reset();
  await insertActivityScreenshot({
    id: "44444444-4444-4444-4444-444444444444",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "Some Title",
    activityLevel: 10,
    capturedAt: new Date(),
    source: "agent",
    signal: { keystrokeCount: -5, distinctKeyCount: "lots", mouseDistancePx: 3.9 },
  });
  const params = calls[0].params;
  assert.deepEqual(params.slice(-6, -1), [0, 0, 3, 0, 0]);
});

test("a screenshot's perceptual hash is persisted as the trailing column", async () => {
  reset();
  await insertActivityScreenshot({
    id: "77777777-7777-7777-7777-777777777777",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "Some Title",
    activityLevel: 90,
    capturedAt: new Date(),
    source: "agent",
    perceptualHash: "abcdef0123456789",
  });
  assert.equal(calls[0].params.at(-1), "abcdef0123456789");
});

test("a missing perceptual hash persists null, not a crash", async () => {
  reset();
  await insertActivityScreenshot({
    id: "88888888-8888-8888-8888-888888888888",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "Some Title",
    activityLevel: 90,
    capturedAt: new Date(),
    source: "agent",
  });
  assert.equal(calls[0].params.at(-1), null);
});

test("a merged app-log row accumulates the signal instead of overwriting it", async () => {
  reset();
  responses.push({ rows: [{ id: "app-id-1" }] }); // resolveAppId
  responses.push({ rows: [{ id: "existing-log-row" }] }); // merge UPDATE hits an open row
  await insertActivityAppLog({
    id: "55555555-5555-5555-5555-555555555555",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "tab",
    startedAt: new Date(),
    durationSeconds: 15,
    source: "agent",
    signal: { keystrokeCount: 10, distinctKeyCount: 5, mouseDistancePx: 100, injectedEventCount: 0, activeSecondsInWindow: 15 },
  });
  // Only resolveAppId + the merge UPDATE ran - no fresh INSERT.
  assert.equal(calls.length, 2);
  const mergeParams = calls[1].params;
  assert.equal(mergeParams.length, 11, "duration + started/ended + 3 match keys + cutoff + 5 signal fields");
  assert.deepEqual(mergeParams.slice(-5), [10, 5, 100, 0, 15]);
});

test("a fresh app-log row (no open row to merge into) inserts the signal directly", async () => {
  reset();
  responses.push({ rows: [{ id: "app-id-1" }] }); // resolveAppId
  responses.push({ rows: [] }); // merge UPDATE finds nothing to extend
  responses.push({ rows: [] }); // fresh INSERT
  await insertActivityAppLog({
    id: "66666666-6666-6666-6666-666666666666",
    memberId: MEMBER_ID,
    sessionId: "sess-1",
    appName: "Chrome",
    pageTitle: "tab",
    startedAt: new Date(),
    durationSeconds: 30,
    source: "agent",
    signal: { keystrokeCount: 3, distinctKeyCount: 3, mouseDistancePx: 0, injectedEventCount: 0, activeSecondsInWindow: 30 },
  });
  assert.equal(calls.length, 3);
  const insertParams = calls[2].params;
  assert.deepEqual(insertParams.slice(-5), [3, 3, 0, 0, 30]);
});
