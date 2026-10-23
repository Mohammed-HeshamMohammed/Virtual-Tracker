// Owner<->member messaging (PLAN-notifications-and-owner-messaging.md Part A).
// The rules that matter here are the boundaries: who may open a thread, who
// may read or reply to one, and that a recipient list can never reach outside
// the sender's own organization. Those are run on real rows in messaging.pglite.test.js; this
// file keeps the input checks that refuse a message before anything is looked up.
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
