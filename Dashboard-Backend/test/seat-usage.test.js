// The seat guard every add/invite path runs (seat-usage.service.js). Before
// it existed, tenant.service.js's assertSeatAvailable was defined but called
// from nowhere, so a customer account's seat limit was displayed and never
// enforced.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ sql: string, params: any[] }[]} */
let calls = [];
let seatLimit = 5;
let used = 0;
let tenantSwitches = [];
let requestTenant = "tenant-a";

const client = {
  query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM tenants WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ seat_limit: seatLimit }] };
    if (/AS used/.test(sql)) return { rows: [{ used }] };
    return { rows: [] };
  },
};

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async () => [],
    withTransaction: async (fn) => fn(client),
    withTenant: async (tenantId, fn) => {
      tenantSwitches.push(tenantId);
      return fn();
    },
  },
});
mock.module("../src/lib/postgres/audit-actor.js", {
  namedExports: { currentTenantId: () => requestTenant },
});

const { withSeatsAvailable, setTenantSeatLimit, usedSeatsSql, SeatLimitError } = await import(
  "../src/modules/customer-accounts/seat-usage.service.js"
);

function reset({ limit = 5, inUse = 0, tenant = "tenant-a" } = {}) {
  calls = [];
  tenantSwitches = [];
  seatLimit = limit;
  used = inUse;
  requestTenant = tenant;
}

test("an unlimited tenant is never counted - the default setup pays nothing", async () => {
  reset({ limit: 2147483647, inUse: 999 });
  let inserted = false;
  await withSeatsAvailable("tenant-a", 3, { insert: async () => { inserted = true; } });
  assert.equal(inserted, true);
  assert.ok(!calls.some((c) => /AS used/.test(c.sql)), "no count query for an unlimited tenant");
});

test("a request that fits is inserted inside the same locked transaction", async () => {
  reset({ limit: 5, inUse: 2 });
  let insertedWith = null;
  await withSeatsAvailable("tenant-a", 3, { insert: async (c) => { insertedWith = c; } });
  assert.equal(insertedWith, client, "insert must get the transaction's own client");
  assert.match(calls[0].sql, /FOR UPDATE/, "the tenant row is locked before counting");
});

test("a request that does not fit is refused whole, before anything is inserted", async () => {
  reset({ limit: 5, inUse: 3 });
  let inserted = false;
  await assert.rejects(
    withSeatsAvailable("tenant-a", 3, { insert: async () => { inserted = true; } }),
    (e) => e instanceof SeatLimitError && e.status === 409 && /Only 2 of 5 seats are open/.test(e.message),
  );
  assert.equal(inserted, false);
});

test("a full tenant says so plainly", async () => {
  reset({ limit: 4, inUse: 4 });
  await assert.rejects(withSeatsAvailable("tenant-a", 1), /All 4 seats are in use/);
});

test("rows being converted are excluded from the count, not double-counted", async () => {
  reset({ limit: 5, inUse: 0 });
  await withSeatsAvailable("tenant-a", 1, { excludeInviteIds: ["inv-1"], excludePendingUids: ["uid-1"] });
  const count = calls.find((c) => /AS used/.test(c.sql));
  assert.deepEqual(count.params, ["tenant-a", ["inv-1"], ["uid-1"]]);
});

test("a public route with no signed-in tenant is counted under the invite's tenant", async () => {
  reset({ tenant: null });
  await withSeatsAvailable("tenant-b", 1);
  assert.deepEqual(tenantSwitches, ["tenant-b"]);
});

test("a signed-in request in its own tenant keeps its context (and audit actor)", async () => {
  reset({ tenant: "tenant-a" });
  await withSeatsAvailable("tenant-a", 1);
  assert.deepEqual(tenantSwitches, []);
});

test("used seats count members, pending invites AND pre-provisioned accounts", () => {
  const sql = usedSeatsSql("$1");
  assert.match(sql, /FROM members m WHERE m\.tenant_id = \$1 AND m\.status = 'active'/);
  assert.match(sql, /FROM invites i WHERE i\.tenant_id = \$1 AND i\.status = 'pending_signup'/);
  assert.match(sql, /FROM pending_auth_members p WHERE p\.tenant_id = \$1/);
});

test("the seat limit cannot be set below what is in use", async () => {
  reset({ limit: 2147483647, inUse: 7 });
  await assert.rejects(setTenantSeatLimit("main", 6), (e) => e.status === 409 && /below 7/.test(e.message));
  reset({ limit: 2147483647, inUse: 7 });
  const result = await setTenantSeatLimit("main", 7);
  assert.deepEqual(result, { from: 2147483647, to: 7 });
});

test("null means unlimited; nonsense is rejected", async () => {
  reset({ limit: 10, inUse: 3 });
  assert.deepEqual(await setTenantSeatLimit("main", null), { from: 10, to: 2147483647 });
  for (const bad of [0, -1, 2.5, "ten", 1_000_000]) {
    reset();
    await assert.rejects(setTenantSeatLimit("main", bad), (e) => e.status === 400, String(bad));
  }
});
