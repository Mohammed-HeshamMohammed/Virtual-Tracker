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
const redisState = { configured: true, failing: false, oldRedis: false };

function fakeRedis() {
  return {
    set: async (...args) => {
      if (redisState.failing) throw new Error("redis down");
      if (redisState.oldRedis && args.includes("GET")) throw new Error("ERR syntax error");
      writes.push(args);
      const previous = store.get(args[0]) ?? null;
      store.set(args[0], args[1]);
      return args.includes("GET") ? previous : "OK";
    },
    get: async (k) => {
      if (redisState.failing) throw new Error("redis down");
      return store.get(k) ?? null;
    },
    exists: async (k) => (store.has(k) ? 1 : 0),
    multi: () => {
      const ops = [];
      const chain = {
        getset: (k, v) => {
          ops.push(["getset", k, v]);
          return chain;
        },
        expire: (k, ttl) => {
          ops.push(["expire", k, ttl]);
          return chain;
        },
        exec: async () =>
          ops.map(([op, k, v]) => {
            writes.push([op, k, v]);
            if (op === "getset") {
              const previous = store.get(k) ?? null;
              store.set(k, v);
              return [null, previous];
            }
            return [null, 1];
          }),
      };
      return chain;
    },
  };
}

mock.module("../src/lib/redis/client.js", {
  namedExports: {
    getRedisClient: () => (redisState.configured ? fakeRedis() : null),
  },
});
mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: { updatePgSession: async () => {} },
});

const {
  HEARTBEAT_GAP_WARN_MS,
  HEARTBEAT_TTL_SEC,
  __resetHeartbeatRedisSupportForTests,
  getAgentPresence,
  heartbeatGapMs,
  isReportableHeartbeatGap,
  touchAgentHeartbeat,
} = await import("../src/modules/activity/agent-heartbeat.js");

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
  redisState.oldRedis = false;
  __resetHeartbeatRedisSupportForTests();
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
  const [k, value, ex, ttl, get] = writes[0];
  assert.equal(k, "agent:heartbeat:member-1");
  assert.equal(ex, "EX");
  assert.equal(ttl, HEARTBEAT_TTL_SEC);
  // Returns the heartbeat it replaced, in the same round trip (E3).
  assert.equal(get, "GET");
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

// ---- E3: gaps between check-ins -------------------------------------------

test("the gap threshold is half the TTL - early warning before the TTL runs out", () => {
  assert.equal(HEARTBEAT_GAP_WARN_MS, (HEARTBEAT_TTL_SEC * 1000) / 2);
});

test("a gap is measured from the previous check-in", () => {
  const now = Date.parse("2026-09-11T10:00:45Z");
  assert.equal(heartbeatGapMs(String(Date.parse("2026-09-11T10:00:00Z")), now), 45_000);
});

// None of these is a gap: there is nothing real to measure from.
test("a first check-in, an expired key or a legacy value is not a gap", () => {
  const now = Date.now();
  assert.equal(heartbeatGapMs(null, now), null, "first check-in / key expired");
  assert.equal(heartbeatGapMs("1", now), null, "the pre-timestamp value, still in Redis after the deploy");
  assert.equal(heartbeatGapMs("not-a-number", now), null);
  assert.equal(heartbeatGapMs(String(now + 5_000), now), null, "a clock that ran backwards");
});

test("only gaps past the threshold are reported", () => {
  assert.equal(isReportableHeartbeatGap(null), false);
  assert.equal(isReportableHeartbeatGap(15_000), false, "a normal poll interval");
  assert.equal(isReportableHeartbeatGap(HEARTBEAT_GAP_WARN_MS), false);
  assert.equal(isReportableHeartbeatGap(HEARTBEAT_GAP_WARN_MS + 1), true);
});

test("a check-in reports the gap since the last one", async () => {
  store.set("agent:heartbeat:member-1", String(Date.now() - 45_000));
  const { gapMs } = await touchAgentHeartbeat("member-1");
  assert.ok(gapMs >= 45_000 && gapMs < 46_000, `measured ${gapMs}ms`);
  assert.ok(isReportableHeartbeatGap(gapMs));
});

test("the first check-in measures nothing", async () => {
  assert.deepEqual(await touchAgentHeartbeat("member-9"), { gapMs: null });
});

// Measuring the gap must not cost the agent's frequent check-ins a second
// request, on new Redis or old.
test("on Redis without SET ... GET it falls back to one transaction, and remembers", async () => {
  redisState.oldRedis = true;
  store.set("agent:heartbeat:member-1", String(Date.now() - 40_000));
  const first = await touchAgentHeartbeat("member-1");
  assert.ok(first.gapMs >= 40_000, "the gap is still measured");
  assert.deepEqual(
    writes.map((w) => w[0]),
    ["getset", "expire"],
    "GETSET + EXPIRE, sent together",
  );
  assert.equal(writes[1][2], HEARTBEAT_TTL_SEC, "the TTL is still applied");

  writes.length = 0;
  await touchAgentHeartbeat("member-1");
  assert.deepEqual(writes.map((w) => w[0]), ["getset", "expire"], "no second attempt at SET ... GET");
});

test("a Redis failure is swallowed and measures nothing", async () => {
  redisState.failing = true;
  assert.deepEqual(await touchAgentHeartbeat("member-1"), { gapMs: null });
});
