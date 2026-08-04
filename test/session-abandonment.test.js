// Guards TC-1: a Redis outage (or REDIS_URL simply unset) must never be read
// as evidence that an employee stopped working. Before this fix,
// isSessionAbandoned() delegated to isAgentOnline(), which returns false
// whenever Redis is unreachable OR unconfigured - indistinguishable from
// "the agent is genuinely gone" - and findOpenSession() acted on that by
// closing the session. Since the agent polls every 5s, a Redis blip closed
// every active session, for every tracked employee, within seconds.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

// agent-heartbeat.js statically imports the real Redis and Postgres client
// modules, which pull in ioredis/pg - not installed in this checkout. Mocked
// out exactly like the existing tests mock their dependencies (see
// timer-allowance.test.js); isSessionAbandoned no longer calls either one,
// which this test suite is precisely what proves.
mock.module("../src/lib/redis/client.js", {
  exports: {
    getRedisClient: () => {
      throw new Error("isSessionAbandoned must not touch Redis at all");
    },
  },
});
mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  exports: { updatePgSession: async () => {} },
});

const { isSessionAbandoned } = await import(
  "../src/modules/activity/agent-heartbeat.js"
);

function agentSession(patch = {}) {
  return {
    id: "session-1",
    member_id: "member-1",
    source: "agent",
    status: "active",
    updated_at: new Date().toISOString(),
    ...patch,
  };
}

test("a session synced moments ago is never abandoned, regardless of Redis", async () => {
  // No Redis client is configured in this test process at all (REDIS_URL is
  // unset), which used to be exactly the condition that closed every session.
  assert.equal(await isSessionAbandoned(agentSession()), false);
});

test("a session with no updated_at yet is not abandoned", async () => {
  assert.equal(await isSessionAbandoned(agentSession({ updated_at: null })), false);
});

test("a session stale well past the sync interval is abandoned", async () => {
  const staleAt = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 minutes
  assert.equal(await isSessionAbandoned(agentSession({ updated_at: staleAt })), true);
});

test("a session just inside the staleness window is not abandoned", async () => {
  const recentAt = new Date(Date.now() - 30_000).toISOString(); // 30s - well under 90s
  assert.equal(await isSessionAbandoned(agentSession({ updated_at: recentAt })), false);
});

test("web-sourced sessions are never considered abandoned by this path", async () => {
  const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(
    await isSessionAbandoned(agentSession({ source: "web", updated_at: staleAt })),
    false,
  );
});

test("a stopped session is never considered abandoned", async () => {
  const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(
    await isSessionAbandoned(agentSession({ status: "stopped", updated_at: staleAt })),
    false,
  );
});

test("null session is never abandoned", async () => {
  assert.equal(await isSessionAbandoned(null), false);
});
