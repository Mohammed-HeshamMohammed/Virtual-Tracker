// The dashboard asked isAgentOnline() every 5s and paused the timer when the
// agent read as offline. The heartbeat key it read was written with a 15s TTL
// by the agent's session poll - and agent v1.0.2 moved that poll to every third
// 5s tick, so writes came at least 15s apart. The key expired before every
// refresh, and a dashboard check landing in that gap paused a timer whose agent
// was running perfectly well.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const writes = [];
const store = new Map();
const redisState = { configured: true, failing: false };

mock.module("../src/lib/redis/client.js", {
  namedExports: {
    getRedisClient: () =>
      redisState.configured
        ? {
            set: async (...args) => {
              if (redisState.failing) throw new Error("redis down");
              writes.push(args);
              store.set(args[0], args[1]);
            },
            get: async (k) => {
              if (redisState.failing) throw new Error("redis down");
              return store.get(k) ?? null;
            },
            exists: async (k) => (store.has(k) ? 1 : 0),
          }
        : null,
  },
});
mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: { updatePgSession: async () => {} },
});

const { HEARTBEAT_TTL_SEC, getAgentPresence, touchAgentHeartbeat } = await import(
  "../src/modules/activity/agent-heartbeat.js"
);

/**
 * The agent's cadence, read from its own source when it is in this checkout,
 * so changing it without revisiting the TTL fails here (PLAN F4). The
 * backend's production branch does not carry the agent's source; there the
 * values pinned below stand in.
 */
function agentConstant(file, name, pinned) {
  try {
    const src = readFileSync(new URL(`../../Tauri-App-Extension/src-tauri/src/${file}`, import.meta.url), "utf8");
    const match = src.match(new RegExp(`const ${name}:\\s*[a-z0-9]+\\s*=\\s*(\\d+)`));
    return match ? Number(match[1]) : pinned;
  } catch {
    return pinned;
  }
}

const SESSION_POLL_SEC = agentConstant("constants.rs", "SESSION_POLL_SEC", 5);
const SESSION_FETCH_EVERY_N_TICKS = agentConstant("agent/tracker.rs", "SESSION_FETCH_EVERY_N_TICKS", 3);
const HTTP_TIMEOUT_SEC = agentConstant("constants.rs", "HTTP_TIMEOUT_SEC", 15);

test.beforeEach(() => {
  writes.length = 0;
  store.clear();
  redisState.configured = true;
  redisState.failing = false;
});

test("a heartbeat outlives the agent's widest gap between writes", () => {
  // A poll every Nth tick, one extra tick when a poll yields the client to the
  // UI, and a request that runs to the HTTP timeout.
  const widestGapSec =
    SESSION_POLL_SEC * SESSION_FETCH_EVERY_N_TICKS + SESSION_POLL_SEC + HTTP_TIMEOUT_SEC;
  assert.ok(
    HEARTBEAT_TTL_SEC > widestGapSec,
    `TTL ${HEARTBEAT_TTL_SEC}s must exceed the agent's ${widestGapSec}s gap between writes ` +
      `(poll ${SESSION_POLL_SEC}s x ${SESSION_FETCH_EVERY_N_TICKS} + ${SESSION_POLL_SEC}s + ${HTTP_TIMEOUT_SEC}s), ` +
      `or a healthy agent reads as offline between them`,
  );
});

test("the heartbeat is written with the TTL and the time it was heard", async () => {
  const before = Date.now();
  await touchAgentHeartbeat("member-1");
  assert.equal(writes.length, 1);
  const [k, value, ex, ttl] = writes[0];
  assert.equal(k, "agent:heartbeat:member-1");
  assert.equal(ex, "EX");
  assert.equal(ttl, HEARTBEAT_TTL_SEC);
  assert.ok(Number(value) >= before && Number(value) <= Date.now(), "value is the write time");
});

test("no member means no write", async () => {
  await touchAgentHeartbeat("");
  await touchAgentHeartbeat(null);
  assert.deepEqual(writes, []);
});

test("a fresh heartbeat reads as online, with when it was seen", async () => {
  await touchAgentHeartbeat("member-1");
  const { presence, lastSeenAt } = await getAgentPresence("member-1");
  assert.equal(presence, "online");
  assert.ok(lastSeenAt && !Number.isNaN(Date.parse(lastSeenAt)));
});

test("no heartbeat reads as offline", async () => {
  assert.deepEqual(await getAgentPresence("member-2"), { presence: "offline", lastSeenAt: null });
});

// The core of R1: a Redis outage must not look like every agent vanishing.
test("a Redis failure reads as unknown, never as offline", async () => {
  await touchAgentHeartbeat("member-1");
  redisState.failing = true;
  assert.deepEqual(await getAgentPresence("member-1"), { presence: "unknown", lastSeenAt: null });
});

test("Redis not configured reads as unknown, never as offline", async () => {
  redisState.configured = false;
  assert.deepEqual(await getAgentPresence("member-1"), { presence: "unknown", lastSeenAt: null });
});
