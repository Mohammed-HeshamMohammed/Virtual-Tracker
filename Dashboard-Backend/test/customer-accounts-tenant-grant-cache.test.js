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

  // The main organization is seeded with period_end = 'infinity' precisely so
  // the grant gate is a no-op for every ordinary member without special-casing
  // type = 'main'. node-postgres parses a timestamptz 'infinity' into the
  // NUMBER Infinity (not a Date, not a string), and new Date(Infinity) is an
  // Invalid Date whose getTime() is NaN - and every comparison with NaN is
  // false. So the main tenant read as EXPIRED, and the auth-middleware gate
  // plus session-bootstrap turned that into 403 SUBSCRIPTION_EXPIRED on every
  // authenticated request, for every user and the desktop agent alike.
  await t.test("the main tenant's 'infinity' period_end is active, not expired", async () => {
    currentRow = { id: "main", lifecycle: "live", period_end: Infinity, seat_limit: 2147483647 };
    const grant = await resolveTenantGrantCached("main");
    assert.equal(grant.active, true, "a never-expiring tenant must never read as expired");
  });

  await t.test("a '-infinity' period_end is expired", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: -Infinity, seat_limit: 5 };
    const grant = await resolveTenantGrantCached("t1");
    assert.equal(grant.active, false);
  });

  // pg hands back a Date for an ordinary timestamptz, not the ISO string the
  // tests above happen to use - so pin both shapes.
  await t.test("a Date period_end is compared correctly", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() + 60_000), seat_limit: 5 };
    assert.equal((await resolveTenantGrantCached("t1")).active, true);
    clearTenantGrantCache();
    currentRow = { id: "t1", lifecycle: "live", period_end: new Date(Date.now() - 60_000), seat_limit: 5 };
    assert.equal((await resolveTenantGrantCached("t1")).active, false);
  });

  // Not a real shape from pg, but if period_end were ever unreadable the gate
  // must not hand out access it cannot justify.
  await t.test("an unreadable period_end is not active", async () => {
    currentRow = { id: "t1", lifecycle: "live", period_end: "not-a-date", seat_limit: 5 };
    assert.equal((await resolveTenantGrantCached("t1")).active, false);
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
