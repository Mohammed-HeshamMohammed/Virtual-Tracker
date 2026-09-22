// verification-code.service.js against a tiny in-memory stand-in for the
// verification_codes table, exercising it through the same INSERT/SELECT/
// UPDATE shapes the real Postgres queries use - a full round trip
// (issue -> verify) rather than reaching into the module's private hashing
// helpers, which stay unexported on purpose.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ rows: any[] }} */
const table = { rows: [] };

function reset() {
  table.rows = [];
}

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT count(*)::int AS count FROM verification_codes")) {
        const [memberId, purpose, since] = params;
        const count = table.rows.filter(
          (r) => r.member_id === memberId && r.purpose === purpose && r.created_at >= since,
        ).length;
        return [{ count }];
      }
      if (sql.startsWith("INSERT INTO verification_codes")) {
        const [memberId, purpose, codeHash, expiresAt] = params;
        table.rows.push({
          id: `row-${table.rows.length + 1}`,
          member_id: memberId,
          purpose,
          code_hash: codeHash,
          expires_at: expiresAt,
          attempts: 0,
          used_at: null,
          created_at: new Date().toISOString(),
        });
        return [];
      }
      if (sql.includes("FROM verification_codes") && sql.includes("ORDER BY created_at DESC LIMIT 1")) {
        const [memberId, purpose] = params;
        const rows = table.rows
          .filter((r) => r.member_id === memberId && r.purpose === purpose)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return rows[0] ? [rows[0]] : [];
      }
      if (sql.startsWith("UPDATE verification_codes SET attempts = attempts + 1")) {
        const [id] = params;
        const row = table.rows.find((r) => r.id === id);
        row.attempts += 1;
        return [{ attempts: row.attempts }];
      }
      if (sql.startsWith("UPDATE verification_codes SET used_at = now()")) {
        const [id] = params;
        const row = table.rows.find((r) => r.id === id);
        row.used_at = new Date().toISOString();
        return [];
      }
      throw new Error(`unexpected query in test: ${sql}`);
    },
  },
});

const {
  assertUnlockRequestAllowed,
  issueUnlockCode,
  verifyUnlockCode,
  MAX_ATTEMPTS,
  REQUEST_LIMIT,
} = await import("../src/modules/customer-accounts/verification-code.service.js");

test("customer-accounts verification code", async (t) => {
  t.beforeEach(reset);

  await t.test("a freshly issued code is a zero-padded 6-digit string", async () => {
    const { code, expiresInMinutes } = await issueUnlockCode("member-1");
    assert.match(code, /^\d{6}$/);
    assert.equal(expiresInMinutes, 10);
  });

  await t.test("the plaintext code is never what gets stored", async () => {
    const { code } = await issueUnlockCode("member-1");
    assert.equal(table.rows[0].code_hash.includes(code), false);
  });

  await t.test("the right code verifies and is then marked used", async () => {
    const { code } = await issueUnlockCode("member-1");
    const result = await verifyUnlockCode("member-1", code);
    assert.equal(result.ok, true);
    assert.ok(table.rows[0].used_at);
  });

  await t.test("a used code cannot be replayed", async () => {
    const { code } = await issueUnlockCode("member-1");
    await verifyUnlockCode("member-1", code);
    const second = await verifyUnlockCode("member-1", code);
    assert.equal(second.ok, false);
    assert.match(second.error, /already been used/);
  });

  await t.test("a wrong code is rejected and counted as an attempt", async () => {
    await issueUnlockCode("member-1");
    const result = await verifyUnlockCode("member-1", "000000");
    // "000000" has a 1-in-a-million chance of colliding with the real code -
    // negligible for a test, and if it ever does this assertion just fails
    // loudly rather than lying.
    assert.equal(result.ok, false);
    assert.equal(table.rows[0].attempts, 1);
  });

  await t.test(`the code locks out after ${MAX_ATTEMPTS} wrong attempts`, async () => {
    const { code } = await issueUnlockCode("member-1");
    const wrongCode = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await verifyUnlockCode("member-1", wrongCode);
    }
    // The code itself is now correct-but-locked - even the RIGHT code must
    // no longer work, which is the whole point of a lockout.
    const finalAttempt = await verifyUnlockCode("member-1", code);
    assert.equal(finalAttempt.ok, false);
    assert.match(finalAttempt.error, /Too many wrong attempts/);
  });

  await t.test("an expired code is rejected even if correct", async () => {
    const { code } = await issueUnlockCode("member-1");
    table.rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const result = await verifyUnlockCode("member-1", code);
    assert.equal(result.ok, false);
    assert.match(result.error, /expired/);
  });

  await t.test("verifying with no code ever issued fails cleanly", async () => {
    const result = await verifyUnlockCode("nobody", "123456");
    assert.equal(result.ok, false);
    assert.match(result.error, /Request a new code/);
  });

  await t.test("malformed input never reaches the database", async () => {
    const result = await verifyUnlockCode("member-1", "not-a-code");
    assert.equal(result.ok, false);
    assert.equal(table.rows.length, 0);
  });

  await t.test(`request rate limiting allows exactly ${REQUEST_LIMIT} per window`, async () => {
    for (let i = 0; i < REQUEST_LIMIT; i++) {
      await assertUnlockRequestAllowed("member-1");
      await issueUnlockCode("member-1");
    }
    await assert.rejects(() => assertUnlockRequestAllowed("member-1"), /Too many verification codes/);
  });

  await t.test("rate limiting is per member, not global", async () => {
    for (let i = 0; i < REQUEST_LIMIT; i++) {
      await assertUnlockRequestAllowed("member-1");
      await issueUnlockCode("member-1");
    }
    // member-2 has requested nothing yet - must not be blocked by member-1's usage.
    await assert.doesNotReject(() => assertUnlockRequestAllowed("member-2"));
  });
});
