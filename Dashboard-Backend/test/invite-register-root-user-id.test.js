// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 9: tenants.root_user_id
// was created and read but never written anywhere - confirmed by a
// whole-repo search before this fix (§0.1a). Source-level, matching this
// file's own established convention for its huge import graph (see
// invite-tree-parent.test.js / invite-token-tenant-lookup.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/modules/members/routes/member-invites.routes.js", import.meta.url),
  "utf8",
);

test("isEnterpriseRole and queryAsAdmin are imported", () => {
  assert.match(src, /import\s*\{[^}]*\bisEnterpriseRole\b[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/http\/role-hierarchy\.js"/);
  assert.match(src, /import\s*\{[^}]*\bqueryAsAdmin\b[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/postgres\/client\.js"/);
});

test("root_user_id is set only for an Enterprise role, guarded by IS NULL so a second acceptance is a no-op", () => {
  const start = src.indexOf("if (isEnterpriseRole(roleName)");
  assert.ok(start > 0, "the root_user_id block must exist right after the atomic member insert");
  const block = src.slice(start, src.indexOf("\n      }", start));
  assert.match(block, /UPDATE tenants SET root_user_id = \$2, updated_at = now\(\) WHERE id = \$1 AND root_user_id IS NULL/);
  // Runs on the admin identity, not query()/withTenant() - tenants is a
  // control-plane table (tenancy-tables.js's CONTROL_PLANE_TABLES), and
  // vt_app has zero grants on it once the grant-scope fix (§0.1 blocker 2)
  // is live.
  assert.match(block, /await queryAsAdmin\(/);
  assert.doesNotMatch(block, /withTenant\(inviteTenantId/);
});

test("a failed root_user_id link is swallowed, never thrown - it must not fail registration", () => {
  const start = src.indexOf("if (isEnterpriseRole(roleName)");
  const block = src.slice(start, src.indexOf("\n      }", start));
  assert.match(block, /catch \(rootErr\)/);
});
