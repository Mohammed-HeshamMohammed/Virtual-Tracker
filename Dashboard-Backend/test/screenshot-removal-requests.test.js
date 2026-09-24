// Screenshot removal requests: someone who can see their own captures but
// cannot delete them asks for one to be taken down.
//
// The rules worth pinning are the boundaries - whose screenshot you may
// object to, and that approving does not quietly destroy the record of who
// approved it.
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

test("objecting to someone else's screenshot is refused, and not confirmed to exist", async () => {
  reset();
  screenshotRow = { id: "shot-1", member_id: "someone-else" };
  await assert.rejects(
    requestRemoval("m1", "shot-1", "nope"),
    (e) => e instanceof RemovalRequestError && e.status === 404,
    "404, not 403 - a screenshot they cannot see is not confirmed to them",
  );
  assert.ok(!queries.some((q) => /INSERT INTO/.test(q.sql)), "nothing is recorded");
});

test("a screenshot in another tenant cannot be reached", async () => {
  reset();
  const lookup = async () => {
    await requestRemoval("m1", "shot-1", "x").catch(() => {});
    return queries.find((q) => /FROM activity_screenshots/.test(q.sql));
  };
  const q = await lookup();
  assert.match(q.sql, /tenant_id = \$2/);
  assert.equal(q.params[1], "tenant-a");
});

test("asking twice is the same ask, not an error", async () => {
  reset();
  insertReturns = []; // the partial unique index rejected the duplicate
  const result = await requestRemoval("m1", "shot-1", "again");
  assert.deepEqual(result, { created: false, alreadyPending: true });
});

test("approving deletes the screenshot, and records the decision first", async () => {
  reset();
  const result = await resolveRequest("req-1", "manager-1", { approve: true });
  assert.deepEqual(result, { status: "approved" });

  const updateAt = queries.findIndex((q) => /UPDATE screenshot_removal_requests/.test(q.sql));
  const deleteAt = queries.findIndex((q) => /DELETE FROM activity_screenshots/.test(q.sql));
  assert.ok(updateAt >= 0 && deleteAt >= 0);
  assert.ok(updateAt < deleteAt, "the decision is written before the image goes");
  // The FK is ON DELETE SET NULL precisely so this row outlives the image.
  assert.equal(queries[updateAt].params[2], "manager-1", "who approved it is recorded");
});

test("declining keeps the screenshot", async () => {
  reset();
  const result = await resolveRequest("req-1", "manager-1", { approve: false, note: "Work related." });
  assert.deepEqual(result, { status: "declined" });
  assert.ok(
    !queries.some((q) => /DELETE FROM activity_screenshots/.test(q.sql)),
    "a declined request must never delete anything",
  );
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
