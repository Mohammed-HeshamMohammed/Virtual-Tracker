// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 7: "the cross-tenant
// read-only customer Dashboard is not implemented... there is no
// allowlisted business-data viewing surface using vt_readonly_crosstenant."
// These pin the allowlisted query surface itself (readonly-view.service.js)
// and, source-level, that the route wiring gates every open behind the
// tenant-detail 404 check and an audit write - routes.js pulls in tenant.
// service.js's heavy Firebase/GCS import graph, so this follows the same
// static-assertion convention as invite-token-tenant-lookup.test.js for
// that specific problem.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** @type {{ tenantId: string, sql: string, params: unknown[] }[]} */
const calls = [];
let nextRows = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    queryAsReadonlyCrossTenant: async (tenantId, sql, params) => {
      calls.push({ tenantId, sql, params });
      return nextRows;
    },
  },
});

const { listCustomerProjects, listCustomerEmployees, getCustomerActivitySummary } = await import(
  "../src/modules/customer-accounts/readonly-view.service.js"
);

const TENANT = "11111111-1111-4111-8111-111111111111";

test.beforeEach(() => {
  calls.length = 0;
  nextRows = [];
});

test("listCustomerProjects queries only the projects table, scoped to the given tenant", async () => {
  nextRows = [{ id: "p1", name: "Website" }];
  const rows = await listCustomerProjects(TENANT);
  assert.deepEqual(rows, nextRows);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenantId, TENANT);
  assert.match(calls[0].sql, /FROM projects WHERE tenant_id = \$1/);
  assert.deepEqual(calls[0].params, [TENANT]);
});

test("listCustomerEmployees queries only the members table, scoped to the given tenant", async () => {
  nextRows = [{ id: "m1", first_name: "Alice" }];
  const rows = await listCustomerEmployees(TENANT);
  assert.deepEqual(rows, nextRows);
  assert.match(calls[0].sql, /FROM members WHERE tenant_id = \$1/);
});

test("getCustomerActivitySummary aggregates within the tenant and returns a single row", async () => {
  nextRows = [{ active_members: 3, active_projects: 2, active_seconds_7d: 1200 }];
  const summary = await getCustomerActivitySummary(TENANT);
  assert.deepEqual(summary, nextRows[0]);
  assert.match(calls[0].sql, /FROM members WHERE tenant_id = \$1 AND status = 'active'/);
  assert.match(calls[0].sql, /FROM projects WHERE tenant_id = \$1 AND status = 'active'/);
  assert.match(calls[0].sql, /FROM daily_member_active_seconds\s*\n\s*WHERE tenant_id = \$1/);
});

test("getCustomerActivitySummary returns null rather than undefined when nothing comes back", async () => {
  nextRows = [];
  assert.equal(await getCustomerActivitySummary(TENANT), null);
});

// --- route wiring (source-level, see this file's own top comment) ---

const routesSrc = readFileSync(
  new URL("../src/modules/customer-accounts/routes.js", import.meta.url),
  "utf8",
);

test("the view route is allowlisted to exactly projects/employees/activity-summary", () => {
  assert.ok(
    routesSrc.includes("/view\\/(projects|employees|activity-summary)$"),
    "the view route's path pattern must name exactly these three surfaces",
  );
});

test("every view open checks the tenant exists (404s otherwise) and records a 'viewed' audit row before returning data", () => {
  const start = routesSrc.indexOf("const viewMatch = pn.match(");
  assert.ok(start > 0);
  const block = routesSrc.slice(start, routesSrc.indexOf("\n  if (detailMatch && req.method", start));

  const detailCheckAt = block.indexOf("getCustomerTenantDetail(tenantId)");
  const dataFetchAt = block.indexOf("const data =");
  const auditAt = block.indexOf("recordCustomerDataView(tenantId, viewer.memberId, surface)");
  const sendAt = block.indexOf("sendJson(res, origin, 200");

  assert.ok(detailCheckAt > 0 && detailCheckAt < dataFetchAt, "must 404 before fetching business data");
  assert.ok(auditAt > dataFetchAt && auditAt < sendAt, "must audit after fetching but before responding");
});

test("the view route uses queryAsReadonlyCrossTenant only via readonly-view.service.js, never inline", () => {
  assert.doesNotMatch(routesSrc, /queryAsReadonlyCrossTenant/, "routes.js must not bypass the service's allowlist");
  assert.match(routesSrc, /from "\.\/readonly-view\.service\.js"/);
});
