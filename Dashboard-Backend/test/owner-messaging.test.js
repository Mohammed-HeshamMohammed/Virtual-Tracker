// Owner<->member messaging (PLAN-notifications-and-owner-messaging.md Part A).
// The rules that matter here are the boundaries: who may open a thread, who
// may read or reply to one, and that a recipient list can never reach outside
// the sender's own organization.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let queries = [];
let members = [];
let threadRow = null;
let notifications = [];

const client = {
  query: async (sql, params) => {
    queries.push({ sql, params });
    if (/INSERT INTO message_threads/.test(sql)) return { rows: [{ id: "thread-1" }] };
    return { rows: [] };
  },
};

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM members\s+WHERE id = ANY/.test(sql)) return members;
      if (/FROM message_threads WHERE id/.test(sql)) return threadRow ? [threadRow] : [];
      return [];
    },
    withTransaction: async (fn) => fn(client),
  },
});
mock.module("../src/lib/postgres/audit-actor.js", { namedExports: { currentTenantId: () => "tenant-a" } });
mock.module("../src/lib/postgres/ensure-tenancy-schema.js", { namedExports: { MAIN_TENANT_ID: "main" } });
mock.module("../src/modules/notifications/service.js", {
  namedExports: {
    createNotification: async (_db, payload) => {
      notifications.push(payload);
      return "notif-1";
    },
  },
});

const { openThreads, replyToThread, getThread, markThreadRead, MessageError } = await import(
  "../src/modules/messages/service.js"
);

function reset() {
  queries = [];
  notifications = [];
  members = [];
  threadRow = null;
}

test("opening a thread only reaches members of the sender's own organization", async () => {
  reset();
  // Two ids asked for; only one is in this tenant.
  members = [{ id: "m1" }];
  const result = await openThreads("owner-1", {
    memberIds: ["m1", "m-from-another-org"],
    subject: "Please update",
    body: "Your tracker is out of date.",
  });

  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1, "the foreign id is reported, not silently delivered");

  const lookup = queries.find((q) => /FROM members\s+WHERE id = ANY/.test(q.sql));
  assert.match(lookup.sql, /tenant_id = \$2/, "recipients are filtered by tenant in SQL");
  assert.equal(lookup.params[1], "tenant-a");
});

test("a message signals both the web bell and the member's tracker", async () => {
  reset();
  members = [{ id: "m1" }];
  await openThreads("owner-1", { memberIds: ["m1"], subject: "Hello", body: "A message." });

  assert.equal(notifications.length, 1, "a web notification is always written");
  assert.equal(notifications[0].type, "owner_message");
  assert.match(notifications[0].link, /thread=thread-1/, "links to the thread so it can be opened");

  const agentInsert = queries.find((q) => /INSERT INTO agent_notifications/.test(q.sql));
  assert.ok(agentInsert, "the member's tracker inbox gets a row too");
});

test("empty or oversized content is refused before anything is written", async () => {
  reset();
  members = [{ id: "m1" }];
  await assert.rejects(
    openThreads("owner-1", { memberIds: ["m1"], subject: "  ", body: "x" }),
    (e) => e instanceof MessageError && e.status === 400,
  );
  await assert.rejects(
    openThreads("owner-1", { memberIds: ["m1"], subject: "s", body: "x".repeat(2001) }),
    (e) => e.status === 400,
  );
  await assert.rejects(openThreads("owner-1", { memberIds: [], subject: "s", body: "b" }), (e) => e.status === 400);
  assert.equal(notifications.length, 0);
});

test("sending to more than the cap is refused", async () => {
  reset();
  const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
  await assert.rejects(
    openThreads("owner-1", { memberIds: many, subject: "s", body: "b" }),
    (e) => e.status === 400 && /at most 200/.test(e.message),
  );
});

test("a non-participant cannot read or reply, and is not told the thread exists", async () => {
  reset();
  threadRow = { id: "t1", member_id: "m1", opened_by: "owner-1", subject: "s", closed_at: null };
  for (const call of [getThread("t1", "stranger"), replyToThread("t1", "stranger", "hi"), markThreadRead("t1", "stranger")]) {
    await assert.rejects(call, (e) => e.status === 404, "404, not 403 - existence is not disclosed");
  }
});

test("the member can reply, and the reply goes to the Owner", async () => {
  reset();
  threadRow = { id: "t1", member_id: "m1", opened_by: "owner-1", subject: "Please update", closed_at: null };
  await replyToThread("t1", "m1", "Done, thanks.");

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient_id, "owner-1", "the other participant is notified");
  assert.equal(notifications[0].type, "member_reply");
  assert.ok(
    !queries.some((q) => /INSERT INTO agent_notifications/.test(q.sql)),
    "the Owner has no tracker inbox, so no agent row is written",
  );
});

test("the Owner's reply reaches the member's tracker", async () => {
  reset();
  threadRow = { id: "t1", member_id: "m1", opened_by: "owner-1", subject: "s", closed_at: null };
  await replyToThread("t1", "owner-1", "Following up.");
  assert.equal(notifications[0].recipient_id, "m1");
  assert.ok(queries.some((q) => /INSERT INTO agent_notifications/.test(q.sql)));
});

test("a closed conversation takes no more replies", async () => {
  reset();
  threadRow = { id: "t1", member_id: "m1", opened_by: "owner-1", subject: "s", closed_at: new Date() };
  await assert.rejects(replyToThread("t1", "m1", "hello"), (e) => e.status === 409);
});

test("marking read only clears the other side's messages", async () => {
  reset();
  threadRow = { id: "t1", member_id: "m1", opened_by: "owner-1", subject: "s", closed_at: null };
  await markThreadRead("t1", "m1");
  const update = queries.find((q) => /UPDATE thread_messages SET read_at/.test(q.sql));
  assert.match(update.sql, /sender_id <> \$2/, "your own messages are never marked read for you");
  assert.equal(update.params[1], "m1");
});
