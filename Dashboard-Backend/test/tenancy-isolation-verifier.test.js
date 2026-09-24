// The verifier exists because every previous signal about tenant isolation
// was a claim rather than evidence: the flag said "on", the migration said
// "ok", and neither could tell you whether Postgres was actually filtering
// rows. These cover the decision table - what counts as proof, what counts
// as a bypass, and when an unenforced database stops being acceptable.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIsolationReport,
  ISOLATION_ENFORCED,
  ISOLATION_NOT_ENFORCED,
  ISOLATION_UNKNOWN,
} from "../src/lib/postgres/verify-tenancy-isolation.js";
import { listTenantScopedTableNames } from "../src/lib/postgres/tenancy-tables.js";

const ALL_TABLES = listTenantScopedTableNames();

/** Every scoped table correctly configured - the baseline the cases below
 *  break one field at a time. */
function healthyTables() {
  return ALL_TABLES.map((name) => ({
    name,
    rowSecurity: true,
    forceRowSecurity: true,
    hasPolicy: true,
  }));
}

function healthy(overrides = {}) {
  return buildIsolationReport({
    rlsFlagEnabled: true,
    role: { name: "vt_app", superuser: false, bypassRls: false },
    tables: healthyTables(),
    probe: { ran: true, visibleRows: 0, inconclusive: false },
    customerTenants: 0,
    ...overrides,
  });
}

test("a fully configured database with a clean probe reports enforced", () => {
  const report = healthy();
  assert.equal(report.status, ISOLATION_ENFORCED);
  assert.equal(report.critical, false);
  assert.deepEqual(report.reasons, []);
});

test("a superuser connection is never enforced, however perfect the policies are", () => {
  // The failure this whole module exists for. Policies are present, FORCEd
  // and correct; Postgres skips all of them for a superuser, so a catalog
  // check alone would have called this healthy.
  const report = healthy({
    role: { name: "postgres", superuser: true, bypassRls: true },
  });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons.join(" "), /superuser/);
  assert.match(report.reasons.join(" "), /postgres/);
});

test("BYPASSRLS without superuser is reported as the bypass it is", () => {
  const report = healthy({
    role: { name: "vt_admin", superuser: false, bypassRls: true },
  });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons.join(" "), /BYPASSRLS/);
});

test("row security enabled but not FORCEd is not enforcement", () => {
  // ENABLE exempts the table's owner, and the owner is exactly who the app
  // connects as today, so this configuration looks right and filters nothing.
  const tables = healthyTables();
  tables[0].forceRowSecurity = false;
  const report = healthy({ tables });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons.join(" "), /not FORCEd/);
  assert.match(report.reasons.join(" "), new RegExp(tables[0].name));
});

test("a single table missing its policy fails the whole report", () => {
  const tables = healthyTables();
  tables[3].hasPolicy = false;
  const report = healthy({ tables });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons.join(" "), /No tenant_isolation policy/);
});

test("the flag being off is reported before anything else is inspected", () => {
  const report = buildIsolationReport({ rlsFlagEnabled: false, customerTenants: 0 });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons[0], /POSTGRES_TENANCY_RLS_ENABLED/);
});

test("a probe that can still see rows as a non-existent tenant proves nothing is filtered", () => {
  const report = healthy({ probe: { ran: true, visibleRows: 42, inconclusive: false } });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons.join(" "), /must return 0/);
});

test("configuration alone is never enough to report enforced", () => {
  // Without a live probe the catalog is the only evidence, and the catalog
  // is exactly what a bypassing role makes irrelevant.
  const report = healthy({ probe: { ran: false } });
  assert.equal(report.status, ISOLATION_UNKNOWN);
  assert.match(report.reasons.join(" "), /probe did not run/);
});

test("an empty probe table is inconclusive rather than a pass", () => {
  // Zero visible rows because the table is empty is not the same evidence as
  // zero visible rows because the policy filtered them.
  const report = healthy({ probe: { ran: true, visibleRows: 0, inconclusive: true } });
  assert.equal(report.status, ISOLATION_UNKNOWN);
  assert.match(report.reasons.join(" "), /empty/);
});

test("unenforced isolation is not critical while the main tenant is alone", () => {
  const report = healthy({ rlsFlagEnabled: false, customerTenants: 0 });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.equal(report.critical, false);
  assert.match(report.summary, /nothing can leak across tenants today/);
});

test("the same finding becomes critical the moment a customer tenant exists", () => {
  const report = healthy({ rlsFlagEnabled: false, customerTenants: 1 });
  assert.equal(report.critical, true);
  assert.match(report.summary, /NOT enforcing/);
});

test("an enforced database is never critical, whatever the tenant count", () => {
  const report = healthy({ customerTenants: 25 });
  assert.equal(report.status, ISOLATION_ENFORCED);
  assert.equal(report.critical, false);
});

test("a table present in the config but absent from the database is reported", () => {
  const tables = healthyTables().slice(0, -1);
  const report = healthy({ tables });
  assert.equal(report.status, ISOLATION_NOT_ENFORCED);
  assert.match(report.reasons.join(" "), /absent from the database/);
  assert.match(report.reasons.join(" "), new RegExp(ALL_TABLES[ALL_TABLES.length - 1]));
});

test("long table lists are summarized rather than dumped", () => {
  // The report is logged; an 80-table reason line would bury the verdict.
  const tables = healthyTables().map((t) => ({ ...t, hasPolicy: false }));
  const report = healthy({ tables });
  const reason = report.reasons.find((r) => /No tenant_isolation policy/.test(r));
  assert.match(reason, /and \d+ more/);
});

test("the probe tenant id is a value tenants.id can never hold", async () => {
  const { PROBE_TENANT_ID, MAIN_TENANT_ID } = {
    ...(await import("../src/lib/postgres/verify-tenancy-isolation.js")),
    ...(await import("../src/lib/postgres/ensure-tenancy-schema.js")),
  };
  assert.notEqual(PROBE_TENANT_ID, MAIN_TENANT_ID);
  assert.match(PROBE_TENANT_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
