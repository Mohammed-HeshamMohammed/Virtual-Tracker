// Screenshot removal requests: someone who can see their own captures but
// cannot delete them asks for one to be taken down.
//
// The rules worth pinning are the boundaries - whose screenshot you may
// object to, and that approving does not quietly destroy the record of who
// approved it. Those are checked on real rows in inbox-and-requests.pglite.test.js.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

let queries = [];
let screenshotRow = null;
let requestRow = null;
let insertReturns = [{ id: "req-1" }];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM activity_screenshots/.test(sql) && /SELECT id, member_id/.test(sql)) {
        return screenshotRow ? [screenshotRow] : [];
      }
      if (/INSERT INTO screenshot_removal_requests/.test(sql)) return insertReturns;
      if (/SELECT id, screenshot_id, status/.test(sql)) return requestRow ? [requestRow] : [];
      return [];
    },
  },
});
mock.module("../src/lib/postgres/audit-actor.js", { namedExports: { currentTenantId: () => "tenant-a" } });
mock.module("../src/lib/postgres/ensure-tenancy-schema.js", { namedExports: { MAIN_TENANT_ID: "main" } });

const { requestRemoval, resolveRequest, RemovalRequestError } = await import(
  "../src/modules/activity/screenshot-removal.service.js"
);

function reset() {
  queries = [];
  screenshotRow = { id: "shot-1", member_id: "m1" };
  requestRow = { id: "req-1", screenshot_id: "shot-1", status: "pending" };
  insertReturns = [{ id: "req-1" }];
}

test("a member can ask about their own screenshot", async () => {
  reset();
  const result = await requestRemoval("m1", "shot-1", "It caught my banking page.");
  assert.deepEqual(result, { created: true, alreadyPending: false });
  const insert = queries.find((q) => /INSERT INTO screenshot_removal_requests/.test(q.sql));
  assert.equal(insert.params[0], "shot-1");
  assert.equal(insert.params[1], "m1");
});

test("asking twice is the same ask, not an error", async () => {
  reset();
  insertReturns = []; // the partial unique index rejected the duplicate
  const result = await requestRemoval("m1", "shot-1", "again");
  assert.deepEqual(result, { created: false, alreadyPending: true });
});

test("a request cannot be reviewed twice", async () => {
  reset();
  requestRow = { id: "req-1", screenshot_id: "shot-1", status: "approved" };
  await assert.rejects(resolveRequest("req-1", "manager-1", { approve: true }), (e) => e.status === 409);
});

test("an unknown request is a 404", async () => {
  reset();
  requestRow = null;
  await assert.rejects(resolveRequest("nope", "manager-1", { approve: true }), (e) => e.status === 404);
});
