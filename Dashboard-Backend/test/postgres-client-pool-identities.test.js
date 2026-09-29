// client.js keys pools by resolved connection-string URL, not by role name,
// so vt_admin/vt_app/vt_readonly_crosstenant collapse to one physical
// pg.Pool whenever their URLs still fall back to POSTGRES_URL - which is
// every deployment today - and only split once an operator configures a
// genuinely different connection string for one of them (PLAN-customer-
// accounts-and-tenancy.md §0.2 step 1). No live database needed: pg.Pool
// connects lazily, so this only has to prove the identity/splitting logic.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const SAME_URL = "postgres://app:pw@localhost:5432/db";
const DIFFERENT_ADMIN_URL = "postgres://admin:pw@localhost:5432/db";

let env = {
  postgres: { url: SAME_URL, adminUrl: SAME_URL, readonlyCrossTenantUrl: SAME_URL },
};

mock.module("../src/config/env.js", {
  namedExports: { getEnv: () => env },
});

const { getPostgresPool, getAdminPostgresPool, getReadonlyCrossTenantPostgresPool, __closePostgresPoolForTests } =
  await import("../src/lib/postgres/client.js");

test.afterEach(async () => {
  await __closePostgresPoolForTests();
});

test("all three identities share one pool when every URL falls back to POSTGRES_URL", () => {
  env = { postgres: { url: SAME_URL, adminUrl: SAME_URL, readonlyCrossTenantUrl: SAME_URL } };
  const app = getPostgresPool();
  const admin = getAdminPostgresPool();
  const readonly = getReadonlyCrossTenantPostgresPool();
  assert.equal(admin, app, "admin pool should be the same object as the app pool");
  assert.equal(readonly, app, "readonly pool should be the same object as the app pool");
});

test("the admin pool splits off once POSTGRES_ADMIN_URL genuinely differs", () => {
  env = { postgres: { url: SAME_URL, adminUrl: DIFFERENT_ADMIN_URL, readonlyCrossTenantUrl: SAME_URL } };
  const app = getPostgresPool();
  const admin = getAdminPostgresPool();
  const readonly = getReadonlyCrossTenantPostgresPool();
  assert.notEqual(admin, app, "admin pool should split into its own pg.Pool");
  assert.equal(readonly, app, "readonly pool should still share the app pool");
});

test("calling the same identity twice returns the same pool object (no leak of duplicate pools)", () => {
  env = { postgres: { url: SAME_URL, adminUrl: SAME_URL, readonlyCrossTenantUrl: SAME_URL } };
  assert.equal(getPostgresPool(), getPostgresPool());
  assert.equal(getAdminPostgresPool(), getAdminPostgresPool());
});

test("a missing URL yields no pool", () => {
  env = { postgres: { url: null, adminUrl: null, readonlyCrossTenantUrl: null } };
  assert.equal(getPostgresPool(), null);
  assert.equal(getAdminPostgresPool(), null);
  assert.equal(getReadonlyCrossTenantPostgresPool(), null);
});
