// POSTGRES_TENANCY_AUDIT is how the production call sites that reading missed
// get found before enforcement: every ordinary-pool query that touches tenant
// data with no tenant published is reported, once per call site. It must
// never fire for the admin pool (built to run tenant-less), never fire when a
// tenant is published, and never fire when the flag is off.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let auditOn = true;
mock.module("../src/config/env.js", {
  namedExports: { getEnv: () => ({ postgres: { tenancyAudit: auditOn } }) },
});

const { auditTenantlessQuery, __resetTenancyAuditForTests } = await import("../src/lib/postgres/tenancy-audit.js");
const { runWithTenantId } = await import("../src/lib/postgres/audit-actor.js");

const warnings = [];
const originalWarn = console.warn;
test.before(() => {
  console.warn = (...args) => warnings.push(args.join(" "));
});
test.after(() => {
  console.warn = originalWarn;
});
test.beforeEach(() => {
  auditOn = true;
  warnings.length = 0;
  __resetTenancyAuditForTests();
});

function querySite(sql) {
  return auditTenantlessQuery(sql);
}

test("a tenant-scoped table queried with no tenant published is reported with its call site", () => {
  const finding = querySite("SELECT * FROM members WHERE id = $1");
  assert.equal(finding.table, "members");
  assert.match(finding.site, /tenancy-audit\.test\.js/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[tenancy-audit\] "members" queried with no tenant published/);
});

test("the same call site is reported once, not on every call", () => {
  for (let i = 0; i < 5; i++) querySite("SELECT * FROM projects");
  assert.equal(warnings.length, 1);
});

test("views over tenant data count too", () => {
  assert.equal(querySite("SELECT * FROM v_members_enriched")?.table, "v_members_enriched");
});

test("nothing is reported once a tenant is published", async () => {
  await runWithTenantId("00000000-0000-0000-0000-000000000001", async () => {
    assert.equal(querySite("SELECT * FROM members"), null);
  });
  assert.equal(warnings.length, 0);
});

test("global and control-plane tables are not tenant data", () => {
  assert.equal(querySite("SELECT * FROM roles"), null);
  assert.equal(querySite("SELECT * FROM system_meta"), null);
  assert.equal(querySite("SELECT * FROM tenants"), null);
});

test("off by default: nothing is reported when the flag is unset", () => {
  auditOn = false;
  assert.equal(querySite("SELECT * FROM members"), null);
  assert.equal(warnings.length, 0);
});

test("only the ordinary pool is audited - the admin pool runs tenant-less by design", () => {
  const src = readFileSync(new URL("../src/lib/postgres/client.js", import.meta.url), "utf8");
  const body = (name) => {
    const start = src.indexOf(`export async function ${name}(`);
    return src.slice(start, src.indexOf("\n}", start));
  };
  assert.match(body("query"), /auditTenantlessQuery\(sql\)/);
  assert.match(body("queryRaw"), /auditTenantlessQuery\(sql\)/);
  assert.match(body("withTransaction"), /audit: getEnv\(\)\.postgres\?\.tenancyAudit === true/);
  assert.doesNotMatch(body("queryAsAdmin"), /auditTenantlessQuery/);
  assert.doesNotMatch(body("withTransactionAsAdmin"), /audit/);
});
