// unlock-token.js is pure in-memory state - no Postgres mock needed, which
// makes it the cheapest place to pin down the exact guarantees
// PLAN-customer-accounts-and-tenancy.md §16.3 relies on: a token unlocks
// exactly the member it was issued to, for a bounded time, and issuing a
// new one invalidates whatever that member held before.
import test from "node:test";
import assert from "node:assert/strict";
import {
  issueUnlockToken,
  verifyUnlockToken,
  revokeUnlockToken,
  __clearAllUnlockTokensForTests,
} from "../src/modules/customer-accounts/unlock-token.js";

test("customer-accounts unlock token", async (t) => {
  t.beforeEach(() => __clearAllUnlockTokensForTests());

  await t.test("a freshly issued token verifies for its own member", () => {
    const token = issueUnlockToken("member-1");
    assert.equal(verifyUnlockToken(token, "member-1"), true);
  });

  await t.test("a token never verifies for a different member", () => {
    const token = issueUnlockToken("member-1");
    assert.equal(verifyUnlockToken(token, "member-2"), false);
  });

  await t.test("an unknown token is rejected", () => {
    issueUnlockToken("member-1");
    assert.equal(verifyUnlockToken("not-a-real-token", "member-1"), false);
  });

  await t.test("an empty or missing token is rejected", () => {
    assert.equal(verifyUnlockToken("", "member-1"), false);
    assert.equal(verifyUnlockToken(undefined, "member-1"), false);
  });

  await t.test("issuing a new token invalidates the member's previous one", () => {
    const first = issueUnlockToken("member-1");
    const second = issueUnlockToken("member-1");
    assert.equal(verifyUnlockToken(first, "member-1"), false);
    assert.equal(verifyUnlockToken(second, "member-1"), true);
  });

  await t.test("issuing a token for one member does not affect another's", () => {
    const tokenA = issueUnlockToken("member-a");
    const tokenB = issueUnlockToken("member-b");
    assert.equal(verifyUnlockToken(tokenA, "member-a"), true);
    assert.equal(verifyUnlockToken(tokenB, "member-b"), true);
  });

  await t.test("revoking a token makes it unverifiable immediately", () => {
    const token = issueUnlockToken("member-1");
    revokeUnlockToken(token);
    assert.equal(verifyUnlockToken(token, "member-1"), false);
  });
});
