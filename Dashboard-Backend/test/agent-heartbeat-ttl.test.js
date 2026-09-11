// The dashboard asks isAgentOnline() every 5s and pauses the timer when the
// agent reads as offline. The heartbeat key it reads was written with a 15s TTL
// by the agent's session poll - and agent v1.0.2 moved that poll to every third
// 5s tick, so writes came at least 15s apart. The key expired before every
// refresh, and a dashboard check landing in that gap paused a timer whose agent
// was running perfectly well.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const writes = [];

mock.module("../src/lib/redis/client.js", {
  namedExports: {
    getRedisClient: () => ({
      set: async (...args) => {
        writes.push(args);
      },
      exists: async () => 1,
    }),
  },
});
mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: { updatePgSession: async () => {} },
});

const { HEARTBEAT_TTL_SEC, touchAgentHeartbeat } = await import(
  "../src/modules/activity/agent-heartbeat.js"
);

// Mirrors the agent (Tauri-App-Extension): SESSION_POLL_SEC = 5,
// SESSION_FETCH_EVERY_N_TICKS = 3, HTTP_TIMEOUT_SEC = 15.
const SESSION_POLL_SEC = 5;
const SESSION_FETCH_EVERY_N_TICKS = 3;
const HTTP_TIMEOUT_SEC = 15;

test("a heartbeat outlives the agent's widest gap between writes", () => {
  // A poll every third tick, one extra tick when a poll yields the client to
  // the UI, and a request that runs to the HTTP timeout.
  const widestGapSec =
    SESSION_POLL_SEC * SESSION_FETCH_EVERY_N_TICKS + SESSION_POLL_SEC + HTTP_TIMEOUT_SEC;
  assert.ok(
    HEARTBEAT_TTL_SEC > widestGapSec,
    `TTL ${HEARTBEAT_TTL_SEC}s must exceed the ${widestGapSec}s gap, or a healthy agent reads as offline between writes`,
  );
});

test("the TTL is what actually gets written to Redis", async () => {
  writes.length = 0;
  await touchAgentHeartbeat("member-1");
  assert.deepEqual(writes, [["agent:heartbeat:member-1", "1", "EX", HEARTBEAT_TTL_SEC]]);
});

test("no member means no write", async () => {
  writes.length = 0;
  await touchAgentHeartbeat("");
  await touchAgentHeartbeat(null);
  assert.deepEqual(writes, []);
});
