// tenant-resolution.js answers "which tenant is this person in" before any
// tenant is published. Pins: the admin lookup is used, hits are cached,
// misses fall back to the main tenant and are NOT cached (a first-time
// sign-in must not be pinned to main), and an already-published tenant is
// never overridden by an identity lookup.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const MAIN = "00000000-0000-0000-0000-000000000001";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
let rowsFor = () => [];
let adminCalls = 0;
const withTenantCalls = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    queryAsAdmin: async (sql, params) => {
      adminCalls += 1;
      return rowsFor(sql, params);
    },
    withTenant: async (tenantId, fn) => {
      withTenantCalls.push(tenantId);
      return fn();
    },
    getPostgresPool: () => null,
    getAdminPostgresPool: () => null,
    isPostgresConfigured: () => false,
  },
});

const { runWithTenantId } = await import("../src/lib/postgres/audit-actor.js");
const resolution = await import("../src/lib/postgres/tenant-resolution.js");

test.beforeEach(() => {
  resolution.__clearTenantResolutionCacheForTests();
  adminCalls = 0;
  withTenantCalls.length = 0;
  rowsFor = () => [];
});

test("a member's tenant comes from the admin lookup and is cached", async () => {
  rowsFor = () => [{ tenant_id: CUSTOMER }];
  assert.equal(await resolution.resolveTenantIdForFirebaseUid("uid-1"), CUSTOMER);
  assert.equal(await resolution.resolveTenantIdForFirebaseUid("uid-1"), CUSTOMER);
  assert.equal(adminCalls, 1);
});

test("an unknown person falls back to the main tenant, and the miss is not cached", async () => {
  assert.equal(await resolution.resolveTenantIdForFirebaseUid("new-uid"), MAIN);
  rowsFor = () => [{ tenant_id: CUSTOMER }];
  assert.equal(await resolution.resolveTenantIdForFirebaseUid("new-uid"), CUSTOMER);
  assert.equal(adminCalls, 2);
});

test("withTenantForFirebaseUid scopes to the person's tenant when none is published", async () => {
  rowsFor = () => [{ tenant_id: CUSTOMER }];
  const out = await resolution.withTenantForFirebaseUid("uid-2", async () => "ran");
  assert.equal(out, "ran");
  assert.deepEqual(withTenantCalls, [CUSTOMER]);
});

test("an already-published tenant stands - no lookup, no re-scoping", async () => {
  rowsFor = () => [{ tenant_id: CUSTOMER }];
  await runWithTenantId(MAIN, () => resolution.withTenantForFirebaseUid("uid-3", async () => null));
  assert.equal(adminCalls, 0);
  assert.deepEqual(withTenantCalls, []);
});

test("member-id resolution follows the same rules", async () => {
  rowsFor = (sql) => (/WHERE id = \$1/.test(sql) ? [{ tenant_id: CUSTOMER }] : []);
  assert.equal(await resolution.resolveTenantIdForMemberId("m-1"), CUSTOMER);
  await resolution.withTenantForMemberId("m-1", async () => null);
  assert.deepEqual(withTenantCalls, [CUSTOMER]);
  assert.equal(adminCalls, 1, "second resolution is a cache hit");
});
