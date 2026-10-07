// Buzz: the Owner pokes someone's desktop tracker. The boundaries that matter are who it can
// reach (own organization, active, tracker open), how often, and that it is never queued.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let members = [];
let pushed = [];
let reached = 1;
let queries = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT id FROM members/.test(sql)) return members;
      if (/SELECT first_name/.test(sql)) return [{ first_name: "Olive", last_name: "Owner", work_email: "o@x.test" }];
      return [];
    },
    withTransaction: async () => null,
  },
});
mock.module("../src/lib/postgres/audit-actor.js", { namedExports: { currentTenantId: () => "tenant-a" } });
mock.module("../src/lib/postgres/ensure-tenancy-schema.js", { namedExports: { MAIN_TENANT_ID: "main" } });
mock.module("../src/modules/presence/presence-gateway.js", {
  namedExports: {
    pushToTracker: (memberId, message) => {
      pushed.push({ memberId, message });
      return reached;
    },
  },
});
mock.module("../src/modules/messages/service.js", {
  namedExports: {
    MessageError: class MessageError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  },
});

const { sendBuzz, resetBuzzCooldownsForTests, DEFAULT_BUZZ_MESSAGE, BUZZ_COOLDOWN_MS, MAX_BUZZ_MESSAGE } = await import(
  "../src/modules/messages/buzz.js"
);

const MEMBER = "11111111-1111-4111-8111-111111111111";

function reset() {
  members = [{ id: MEMBER }];
  pushed = [];
  queries = [];
  reached = 1;
  resetBuzzCooldownsForTests();
}

test("a buzz reaches the tracker with the owner's name and a default message", async () => {
  reset();
  const result = await sendBuzz("owner-1", { memberId: MEMBER, style: "bluescreen" }, 1_000);
  assert.deepEqual(result, { delivered: true, style: "bluescreen" });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].memberId, MEMBER);
  assert.deepEqual(pushed[0].message, {
    type: "buzz",
    style: "bluescreen",
    corner: "top-right",
    message: DEFAULT_BUZZ_MESSAGE,
    from: "Olive Owner",
    at: 1_000,
  });
});

test("it only reaches active members of the sender's own organization", async () => {
  reset();
  await sendBuzz("owner-1", { memberId: MEMBER }, 1_000);
  const lookup = queries.find((q) => /SELECT id FROM members/.test(q.sql));
  assert.match(lookup.sql, /tenant_id = \$2/);
  assert.match(lookup.sql, /status = 'active'/);
  assert.equal(lookup.params[1], "tenant-a");

  reset();
  members = [];
  await assert.rejects(() => sendBuzz("owner-1", { memberId: MEMBER }), { status: 404 });
  assert.equal(pushed.length, 0);
});

test("you cannot buzz yourself, an empty target, an unknown style or a long message", async () => {
  reset();
  await assert.rejects(() => sendBuzz("owner-1", { memberId: "owner-1" }), { status: 400 });
  await assert.rejects(() => sendBuzz("owner-1", {}), { status: 400 });
  await assert.rejects(() => sendBuzz("owner-1", { memberId: MEMBER, style: "airhorn" }), { status: 400 });
  await assert.rejects(
    () => sendBuzz("owner-1", { memberId: MEMBER, message: "x".repeat(MAX_BUZZ_MESSAGE + 1) }),
    { status: 400 },
  );
  assert.equal(pushed.length, 0);
});

test("a nudge can be sent to any corner of the screen, and nothing else", async () => {
  reset();
  await sendBuzz("owner-1", { memberId: MEMBER, corner: "bottom-left" }, 1_000);
  assert.equal(pushed[0].message.corner, "bottom-left");
  await assert.rejects(() => sendBuzz("owner-1", { memberId: MEMBER, corner: "middle" }, 99_000), { status: 400 });
});

test("the same person cannot be buzzed again inside the cooldown", async () => {
  reset();
  await sendBuzz("owner-1", { memberId: MEMBER }, 10_000);
  await assert.rejects(() => sendBuzz("owner-1", { memberId: MEMBER }, 10_000 + BUZZ_COOLDOWN_MS - 1), { status: 429 });
  await sendBuzz("owner-1", { memberId: MEMBER }, 10_000 + BUZZ_COOLDOWN_MS);
  assert.equal(pushed.length, 2);
});

test("a tracker that is not open is told to the sender, not queued, and costs no cooldown", async () => {
  reset();
  reached = 0;
  await assert.rejects(() => sendBuzz("owner-1", { memberId: MEMBER }, 5_000), { status: 409 });
  reached = 1;
  await sendBuzz("owner-1", { memberId: MEMBER }, 5_001);
  assert.equal(pushed.length, 2, "the failed attempt did not start a cooldown");
});
