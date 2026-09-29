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

test("enforcement off: the app pool is the superuser POSTGRES_URL even if enforce alone is set", () => {
  env = { postgres: { url: SAME_URL, adminUrl: SAME_URL, tenancyEnforce: true, tenancyRlsEnabled: false } };
  assert.equal(getPostgresPool(), getAdminPostgresPool(), "enforce without RLS must not switch identities");
});

test("enforcement on: app and read-only pools log in as their own derived roles, admin stays superuser", async () => {
  const { deriveRolePassword } = await import("../src/lib/postgres/role-credentials.js");
  env = { postgres: { url: SAME_URL, adminUrl: SAME_URL, tenancyEnforce: true, tenancyRlsEnabled: true } };
  const app = getPostgresPool();
  const admin = getAdminPostgresPool();
  const readonly = getReadonlyCrossTenantPostgresPool();
  assert.notEqual(app, admin);
  assert.notEqual(readonly, admin);
  assert.notEqual(readonly, app);
  const creds = (pool) => new URL(pool.options.connectionString);
  assert.equal(creds(app).username, "vt_app");
  assert.equal(creds(app).password, deriveRolePassword(SAME_URL, "vt_app"));
  assert.equal(creds(readonly).username, "vt_readonly_crosstenant");
  assert.equal(creds(admin).username, "app");
});

test("enforcement on: an explicit POSTGRES_APP_URL overrides the derived one", () => {
  const explicit = "postgres://vt_app:managed@localhost:5432/db";
  env = { postgres: { url: SAME_URL, adminUrl: SAME_URL, appUrl: explicit, tenancyEnforce: true, tenancyRlsEnabled: true } };
  assert.equal(new URL(getPostgresPool().options.connectionString).password, "managed");
});

test("enforcement on without a superuser password fails closed - no pool, never a superuser fallback", () => {
  const noPassword = "postgres://app@localhost:5432/db";
  env = { postgres: { url: noPassword, adminUrl: noPassword, tenancyEnforce: true, tenancyRlsEnabled: true } };
  assert.equal(getPostgresPool(), null);
});
