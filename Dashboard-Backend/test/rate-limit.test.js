// The rate limiter used to key every bucket by IP address alone. The desktop
// agent polls /api/activity/* every few seconds while tracking, and every
// member behind the same office network, VPN, or CGNAT shares one IP - so
// they shared one 240-req/min bucket too, which background polling alone
// could exhaust with a handful of people tracking at once. A Start/Pause/
// Stop click from anyone on that IP then came back 429, for reasons that had
// nothing to do with what they personally did.
import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../src/http/rate-limit.js";

const REMOTE_IP = "203.0.113.9"; // TEST-NET-3, never a real client.

function req({ ip = REMOTE_IP, token } = {}) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: ip },
  };
}

function activityUrl() {
  return new URL("http://localhost/api/activity/session");
}

test("two members behind the same IP get their own budgets, not a shared one", async () => {
  const url = activityUrl();
  // Exhaust member A's own 240/min activity budget.
  let lastForA = null;
  for (let i = 0; i < 240; i += 1) {
    lastForA = await checkRateLimit(req({ token: "member-a-token" }), url);
  }
  assert.equal(lastForA, null, "the 240th request is still within member A's own limit");
  assert.ok(
    await checkRateLimit(req({ token: "member-a-token" }), url),
    "member A's 241st request is the one that gets rate-limited",
  );

  // Member B, same IP, hasn't made a single request yet.
  const forB = await checkRateLimit(req({ token: "member-b-token" }), url);
  assert.equal(forB, null, "member B is not paying for member A's traffic");
});

test("the same member is still capped, wherever the requests come from", async () => {
  const url = activityUrl();
  const token = "roaming-member-token";
  for (let i = 0; i < 240; i += 1) {
    await checkRateLimit(req({ ip: "198.51.100.1", token }), url);
  }
  const limited = await checkRateLimit(req({ ip: "198.51.100.2", token }), url);
  assert.ok(limited, "the same bearer token is one budget, even from a different address");
});

test("a request with no token still falls back to IP - pre-auth traffic has no member to key by", async () => {
  const url = new URL("http://localhost/api/auth/session-bootstrap");
  for (let i = 0; i < 60; i += 1) {
    await checkRateLimit(req({ ip: "198.51.100.50" }), url);
  }
  const limited = await checkRateLimit(req({ ip: "198.51.100.50" }), url);
  assert.ok(limited, "unauthenticated requests from one IP still share a budget - this is what stops login brute-forcing");

  const otherIp = await checkRateLimit(req({ ip: "198.51.100.51" }), url);
  assert.equal(otherIp, null, "a different IP with no token is a separate budget");
});

test("localhost is exempt whether or not the request carries a token", async () => {
  const url = activityUrl();
  for (let i = 0; i < 500; i += 1) {
    assert.equal(await checkRateLimit(req({ ip: "127.0.0.1", token: "some-token" }), url), null);
    assert.equal(await checkRateLimit(req({ ip: "::1" }), url), null);
  }
});
