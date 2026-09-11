// The bell can read one, read several, read all, clear one, clear the read
// ones, clear several and clear everything. These pin that every one of those
// stays inside the member's own notifications, that clearing everything takes
// an explicit request, and that bad ids are turned away before Postgres sees
// them (a non-UUID used to reach it as a cast error - a 500).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

const MEMBER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ID1 = "11111111-2222-4333-8444-555555555555";
const ID2 = "66666666-7777-4888-9999-000000000000";

const calls = [];
const state = { rows: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/count\(\*\)/i.test(sql)) return [{ unread: 42 }];
      return state.rows;
    },
  },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => {} },
});
mock.module("../src/http/auth-context.js", {
  namedExports: { requireAuthContext: () => ({ memberId: MEMBER }) },
});
mock.module("../src/http/response.js", {
  namedExports: {
    sendJson: (res, _origin, status, body) => {
      res.status = status;
      res.body = body;
    },
  },
});

const { routeNotifications } = await import("../src/modules/notifications/routes.js");

async function call(method, path, body) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = {};
  const res = {};
  const handled = await routeNotifications(req, res, new URL(`http://api.test${path}`), "http://app.test");
  return { handled, status: res.status, body: res.body };
}

test.beforeEach(() => {
  calls.length = 0;
  state.rows = [];
});

test("the list carries the true unread count, not just the loaded page's", async () => {
  const { status, body } = await call("GET", "/api/notifications");
  assert.equal(status, 200);
  assert.equal(body.unreadCount, 42);
  assert.ok(calls.every((c) => c.params[0] === MEMBER), "both queries are the member's own");
});

test("clearing everything takes an explicit all: true - an empty request clears nothing", async () => {
  for (const body of [undefined, {}, { all: "yes" }, []]) {
    const { status } = await call("POST", "/api/notifications/clear", body);
    assert.equal(status, 400, `refused: ${JSON.stringify(body)}`);
  }
  assert.equal(calls.length, 0);

  state.rows = [{ id: ID1 }, { id: ID2 }];
  const { status, body } = await call("POST", "/api/notifications/clear", { all: true });
  assert.equal(status, 200);
  assert.equal(body.cleared, 2);
  assert.equal(calls[0].sql, "DELETE FROM notifications WHERE recipient_id = $1 RETURNING id");
  assert.deepEqual(calls[0].params, [MEMBER]);
});

test("clear read removes only the read ones", async () => {
  await call("POST", "/api/notifications/clear", { readOnly: true });
  assert.match(calls[0].sql, /WHERE recipient_id = \$1 AND read = true/);
  assert.deepEqual(calls[0].params, [MEMBER]);
});

test("clearing by id keeps only real ids, once each, inside the member's own", async () => {
  await call("POST", "/api/notifications/clear", { ids: [ID1, "not-an-id", ID1.toUpperCase(), 7] });
  assert.match(calls[0].sql, /WHERE recipient_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(calls[0].params, [MEMBER, [ID1]]);
});

test("a request with no usable ids is refused before it reaches the database", async () => {
  const tooMany = Array.from({ length: 201 }, () => ID1);
  for (const ids of [["not-an-id"], [], "x", tooMany]) {
    const clear = await call("POST", "/api/notifications/clear", { ids });
    const read = await call("POST", "/api/notifications/read", { ids });
    assert.equal(clear.status, 400);
    assert.equal(read.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("marking several read touches only unread ones of the member's", async () => {
  state.rows = [{ id: ID1 }];
  const { status, body } = await call("POST", "/api/notifications/read", { ids: [ID1, ID2] });
  assert.equal(status, 200);
  assert.equal(body.updated, 1);
  assert.match(calls[0].sql, /UPDATE notifications SET read = true WHERE recipient_id = \$1 AND id = ANY\(\$2::uuid\[\]\) AND read = false/);
  assert.deepEqual(calls[0].params, [MEMBER, [ID1, ID2]]);
});

test("a malformed id is a 404, not a database error", async () => {
  const read = await call("POST", "/api/notifications/not-an-id/read");
  const del = await call("DELETE", "/api/notifications/not-an-id");
  assert.equal(read.status, 404);
  assert.equal(del.status, 404);
  assert.equal(calls.length, 0);
});

test("clearing one is scoped to the member, and someone else's reads as not found", async () => {
  state.rows = [{ id: ID1 }];
  const mine = await call("DELETE", `/api/notifications/${ID1}`);
  assert.equal(mine.status, 200);
  assert.deepEqual(calls[0].params, [ID1, MEMBER]);

  state.rows = [];
  const theirs = await call("DELETE", `/api/notifications/${ID2}`);
  assert.equal(theirs.status, 404);
});

test("a body that is not JSON is a 400", async () => {
  const { status } = await call("POST", "/api/notifications/clear", "{not json");
  assert.equal(status, 400);
  assert.equal(calls.length, 0);
});

test("other paths are left for other routes", async () => {
  const { handled } = await call("GET", "/api/elsewhere");
  assert.equal(handled, false);
});
