// Pins the guarantees PLAN-customer-accounts-and-tenancy.md §16.3 relies on:
// a token unlocks exactly the member it was issued to, for a bounded time,
// issuing a new one invalidates whatever that member held before, and only
// the token's hash is ever stored. The table is faked in memory with the
// same semantics as customer_account_unlock_tokens.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** @type {Map<string, { member_id: string, expires_at: number }>} */
const rows = new Map();
let clock = Date.now();

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    queryAsAdmin: async (sql, params) => {
      if (/^DELETE FROM customer_account_unlock_tokens WHERE member_id = \$1 OR expires_at <= now\(\)/.test(sql)) {
        for (const [k, r] of rows) if (r.member_id === params[0] || r.expires_at <= clock) rows.delete(k);
        return [];
      }
      if (/^INSERT INTO customer_account_unlock_tokens/.test(sql)) {
        rows.set(params[0], { member_id: params[1], expires_at: clock + params[2] * 60_000 });
        return [];
      }
      if (/^SELECT member_id FROM customer_account_unlock_tokens WHERE token_hash = \$1 AND expires_at > now\(\)/.test(sql)) {
        const r = rows.get(params[0]);
        return r && r.expires_at > clock ? [{ member_id: r.member_id }] : [];
      }
      if (/^DELETE FROM customer_account_unlock_tokens WHERE token_hash = \$1/.test(sql)) {
        rows.delete(params[0]);
        return [];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  },
});

const { issueUnlockToken, verifyUnlockToken, revokeUnlockToken } = await import(
  "../src/modules/customer-accounts/unlock-token.js"
);

test.beforeEach(() => {
  rows.clear();
  clock = Date.now();
});

test("a freshly issued token verifies for its own member", async () => {
  const token = await issueUnlockToken("member-1");
  assert.equal(await verifyUnlockToken(token, "member-1"), true);
});

test("a token never verifies for a different member", async () => {
  const token = await issueUnlockToken("member-1");
  assert.equal(await verifyUnlockToken(token, "member-2"), false);
});

test("an unknown, empty or missing token is rejected", async () => {
  await issueUnlockToken("member-1");
  assert.equal(await verifyUnlockToken("not-a-real-token", "member-1"), false);
  assert.equal(await verifyUnlockToken("", "member-1"), false);
  assert.equal(await verifyUnlockToken(undefined, "member-1"), false);
});

test("issuing a new token invalidates the member's previous one, not anyone else's", async () => {
  const first = await issueUnlockToken("member-1");
  const other = await issueUnlockToken("member-2");
  const second = await issueUnlockToken("member-1");
  assert.equal(await verifyUnlockToken(first, "member-1"), false);
  assert.equal(await verifyUnlockToken(second, "member-1"), true);
  assert.equal(await verifyUnlockToken(other, "member-2"), true);
});

test("revoking a token makes it unverifiable immediately", async () => {
  const token = await issueUnlockToken("member-1");
  await revokeUnlockToken(token);
  assert.equal(await verifyUnlockToken(token, "member-1"), false);
});

test("a token expires after its TTL", async () => {
  const token = await issueUnlockToken("member-1");
  clock += 21 * 60_000;
  assert.equal(await verifyUnlockToken(token, "member-1"), false);
});

test("only the token's SHA-256 is stored, never the raw value", async () => {
  const token = await issueUnlockToken("member-1");
  assert.equal(rows.has(token), false);
  assert.equal(rows.has(createHash("sha256").update(token).digest("hex")), true);
});
