// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 2: ensure-tenancy-rls.js
// used to grant ALL TABLES to vt_app and SELECT ON ALL TABLES to
// vt_readonly_crosstenant, which handed both roles access to control-plane
// tables (verification-code hashes, the tenant registry, the commercial
// audit trail) neither should ever touch. This never connects to Postgres:
// it statically checks the generated grant statements and the exported
// per-role table lists.
import test from "node:test";
import assert from "node:assert/strict";
import {
  GRANT_DDL,
  VT_APP_TABLE_NAMES,
  VT_READONLY_TABLE_NAMES,
  CONTROL_PLANE_NAMES,
} from "../src/lib/postgres/ensure-tenancy-rls.js";
import { listGlobalTableNames } from "../src/lib/postgres/tenancy-tables.js";

test("control-plane tables are a real, non-empty list", () => {
  assert.ok(CONTROL_PLANE_NAMES.length > 0);
  assert.deepEqual(
    [...CONTROL_PLANE_NAMES].sort(),
    ["customer_account_audit", "customer_account_unlock_tokens", "tenants", "verification_codes"],
  );
});

test("vt_app's table grant never names a control-plane table", () => {
  for (const name of CONTROL_PLANE_NAMES) {
    assert.equal(VT_APP_TABLE_NAMES.includes(name), false, `${name} should not be in vt_app's grant list`);
  }
});

test("vt_readonly_crosstenant's table grant never names a control-plane or global table", () => {
  const globals = new Set(listGlobalTableNames());
  for (const name of CONTROL_PLANE_NAMES) {
    assert.equal(VT_READONLY_TABLE_NAMES.includes(name), false, `${name} should not be readable cross-tenant`);
  }
  for (const name of VT_READONLY_TABLE_NAMES) {
    assert.equal(globals.has(name), false, `${name} is global reference data, not a tenant's own business data`);
  }
});

test("no GRANT statement mentions ALL TABLES for vt_app or vt_readonly_crosstenant", () => {
  const offenders = GRANT_DDL.filter(
    (stmt) => /ALL TABLES/i.test(stmt) && /vt_app|vt_readonly_crosstenant/.test(stmt),
  );
  assert.deepEqual(offenders, [], "vt_admin may keep ALL TABLES; vt_app/vt_readonly_crosstenant must not");
});

test("the generated grant DDL literally does not contain a control-plane table name outside the vt_admin statement", () => {
  for (const stmt of GRANT_DDL) {
    if (/TO vt_admin\b/.test(stmt)) continue;
    for (const name of CONTROL_PLANE_NAMES) {
      assert.equal(
        stmt.includes(`"${name}"`),
        false,
        `non-admin grant statement unexpectedly names ${name}: ${stmt.slice(0, 80)}...`,
      );
    }
  }
});
