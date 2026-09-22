// PLAN-customer-accounts-and-tenancy.md §16.4: "cache the tenant row, not
// the verdict" - tenant_is_active depends on now(), so caching the boolean
// would keep honoring an expired grant for the length of the TTL. This pins
// that a still-cached row is re-evaluated against the current time on every
// read, not returned as a stale true/false.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {any} */
let currentRow = null;
let queryCalls = 0;

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async () => {
      queryCalls += 1;
      return currentRow ? [currentRow] : [];
    },
  },
});

const {
  resolveTenantGrantCached,
  invalidateTenantGrantCache,
  clearTenantGrantCache,
} = await import("../src/modules/customer-accounts/tenant-grant-cache.js");

test("customer-accounts tenant grant cache", async (t) => {
  t.beforeEach(() => {
    clearTenantGrantCache();
    queryCalls = 0;
    currentRow = null;
  });

  await t.test("a live tenant with a future period_end is active", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() + 60_000).toISOString(), seat_limit: 5 };
    const grant = await resolveTenantGrantCached("t1");
    assert.equal(grant.active, true);
  });

  await t.test("a live tenant whose period_end already passed is NOT active, even freshly read", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() - 1000).toISOString(), seat_limit: 5 };
    const grant = await resolveTenantGrantCached("t1");
    assert.equal(grant.active, false);
  });

  await t.test("a tenant mid-removal is never active regardless of period_end", async () => {
    currentRow = { id: "t1", lifecycle: "removing", period_end: new Date(Date.now() + 60_000).toISOString(), seat_limit: 5 };
    const grant = await resolveTenantGrantCached("t1");
    assert.equal(grant.active, false);
  });

  await t.test("repeated reads within the TTL do not re-query, but still recompute the verdict from the cached period_end", async () => {
    // period_end is 50ms in the future - the ROW is cached, but the second
    // read happens after it has passed, and must reflect that.
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() + 50).toISOString(), seat_limit: 5 };
    const first = await resolveTenantGrantCached("t1");
    assert.equal(first.active, true);
    assert.equal(queryCalls, 1);

    await new Promise((r) => setTimeout(r, 80));
    const second = await resolveTenantGrantCached("t1");
    assert.equal(second.active, false, "a cached row must be re-evaluated against the current time, not returned as a stale verdict");
    assert.equal(queryCalls, 1, "still cached - no second query needed to know the row itself");
  });

  await t.test("invalidating the cache forces a fresh read on the next call", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() + 60_000).toISOString(), seat_limit: 5 };
    await resolveTenantGrantCached("t1");
    assert.equal(queryCalls, 1);

    currentRow = { id: "t1", lifecycle: "removing", period_end: currentRow.period_end, seat_limit: 5 };
    invalidateTenantGrantCache("t1");
    const grant = await resolveTenantGrantCached("t1");
    assert.equal(queryCalls, 2);
    assert.equal(grant.active, false);
  });

  await t.test("a missing tenant (e.g. already removed) resolves to null, not a thrown error", async () => {
    currentRow = null;
    const grant = await resolveTenantGrantCached("gone");
    assert.equal(grant, null);
  });

  await t.test("caches are independent per tenant", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() + 60_000).toISOString(), seat_limit: 5 };
    await resolveTenantGrantCached("t1");
    currentRow = { id: "t2", lifecycle: "removing", period_end: new Date(Date.now() + 60_000).toISOString(), seat_limit: 5 };
    const t2 = await resolveTenantGrantCached("t2");
    assert.equal(t2.active, false);
    assert.equal(queryCalls, 2);
  });
});
