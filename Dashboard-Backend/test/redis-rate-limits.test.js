// The request rate limit and the invite-registration lockout, counted in a real Redis.
//
// Counted in each process's memory, a limit is multiplied by the number of backend instances and
// reset by every deploy. These run against an actual Redis server - TEST_REDIS_URL when set (CI), else
// a throwaway `redis-server` on a spare port - and skip themselves when neither is available.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const url = (rel) => pathToFileURL(`${SRC}/${rel}`).href;

async function freePort() {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startRedis() {
  if (process.env.TEST_REDIS_URL) return { url: process.env.TEST_REDIS_URL, stop: () => {} };
  try {
    execFileSync("redis-server", ["--version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  const port = await freePort();
  const proc = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 400));
  return { url: `redis://127.0.0.1:${port}/0`, stop: () => proc.kill() };
}

const server = await startRedis();

if (!server) {
  test("rate limits in Redis (skipped: no TEST_REDIS_URL and no redis-server on PATH)", { skip: true }, () => {});
} else {
  process.env.REDIS_URL = server.url;
  const { __resetEnvForTests } = await import(url("config/env.js"));
  __resetEnvForTests();
  const redisClient = await import(url("lib/redis/client.js"));
  const { checkRateLimit } = await import(url("http/rate-limit.js"));
  const guard = await import(url("http/invite-abuse-guard.js"));

  const redis = redisClient.getRedisClient();
  before(async () => {
    for (let i = 0; i < 50 && redis.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(redis.status, "ready", "test Redis reachable");
    await redis.flushdb();
  });
  after(async () => {
    await redisClient.__closeRedisForTests();
    server.stop();
  });

  const req = ({ ip = "203.0.113.9", token, email } = {}) => ({
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    socket: { remoteAddress: ip },
    email,
  });
  const activity = new URL("http://localhost/api/activity/session");

  test("the count lives in Redis: another backend process sees requests this one made", async () => {
    // A separate Node process - a second backend instance - spends 240 of this member's
    // 240-per-minute activity budget against the same Redis.
    const child = `
      process.env.REDIS_URL = ${JSON.stringify(server.url)};
      const { getRedisClient } = await import(${JSON.stringify(url("lib/redis/client.js"))});
      const { checkRateLimit } = await import(${JSON.stringify(url("http/rate-limit.js"))});
      const r = getRedisClient();
      while (r.status !== "ready") await new Promise((s) => setTimeout(s, 20));
      const req = { headers: { authorization: "Bearer shared-member" }, socket: { remoteAddress: "203.0.113.9" } };
      let limited = 0;
      for (let i = 0; i < 240; i++) if (await checkRateLimit(req, new URL("http://localhost/api/activity/session"))) limited++;
      console.log(limited);
      await r.quit();
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", child], { encoding: "utf8" });
    assert.equal(out.trim(), "0", "the other instance stayed within the budget");

    const here = await checkRateLimit(req({ token: "shared-member" }), activity);
    assert.ok(here, "this instance's very first request is the 241st, so it is limited");
    assert.equal(here.status, 429);
    assert.ok(here.retryAfterSec >= 1 && here.retryAfterSec <= 60, `retry within the minute window, got ${here.retryAfterSec}`);
  });

  test("the window expires: once Redis drops the counter, the member has a fresh budget", async () => {
    const token = "expiring-member";
    for (let i = 0; i < 240; i++) await checkRateLimit(req({ token }), activity);
    assert.ok(await checkRateLimit(req({ token }), activity), "over the limit");
    const [key] = await redis.keys("rl:member:*:activity");
    const ttl = await redis.pttl(key);
    assert.ok(ttl > 0 && ttl <= 60_000, "the counter carries the window's expiry");
    await redis.flushdb(); // what expiry does at the end of the window
    assert.equal(await checkRateLimit(req({ token }), activity), null);
  });

  test("an email typed with capitals is locked, and cleared, as the same email", async () => {
    const r = { headers: {}, socket: { remoteAddress: "198.51.100.7" } };
    for (let i = 0; i < 5; i++) await guard.recordInviteRegisterFailure(r, "Ann@Example.com");
    const locked = await guard.checkInviteRegisterAllowed({ headers: {}, socket: { remoteAddress: "198.51.100.8" } }, "ann@example.com");
    assert.equal(locked.allowed, false, "the lockout follows the email, from another IP and in lower case");
    assert.ok(locked.retryAfterSeconds > 29 * 60 && locked.retryAfterSeconds <= 30 * 60);

    await guard.recordInviteRegisterSuccess(r, " ANN@example.com ");
    assert.deepEqual(await guard.checkInviteRegisterAllowed(r, "ann@example.com"), { allowed: true });
  });

  test("with Redis unreachable, both limits still answer at once, from memory", async () => {
    await redisClient.__closeRedisForTests();
    process.env.REDIS_URL = `redis://127.0.0.1:${await freePort()}/0`; // nothing listens here
    __resetEnvForTests();
    const started = Date.now();
    assert.equal(await checkRateLimit(req({ token: "offline-member" }), activity), null);
    assert.deepEqual(await guard.checkInviteRegisterAllowed(req(), "x@example.com"), { allowed: true });
    for (let i = 0; i < 5; i++) await guard.recordInviteRegisterFailure(req(), "x@example.com");
    assert.equal((await guard.checkInviteRegisterAllowed(req(), "x@example.com")).allowed, false, "memory still locks out");
    assert.ok(Date.now() - started < 500, "no request waited on the dead Redis");
    await redisClient.__closeRedisForTests();
  });
}
