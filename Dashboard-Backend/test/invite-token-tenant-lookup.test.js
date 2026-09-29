// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 3: a public route
// (invite preview/register) cannot know which tenant an opaque token
// belongs to before it has looked the token up, and under live RLS an
// ordinary vt_app query with no app.tenant_id published sees nothing.
// Source-level, matching this file's own established convention (see
// invite-tree-parent.test.js's comment) - its import graph is most of the
// backend, so the fix is verified by pattern rather than by exercising the
// route through a full mock scaffold.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/modules/members/routes/member-invites.routes.js", import.meta.url),
  "utf8",
);

test("client.js's admin/tenant-scoping helpers are imported", () => {
  assert.match(src, /import\s*\{[^}]*\bqueryAsAdmin\b[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/postgres\/client\.js"/);
  assert.match(src, /import\s*\{[^}]*\bwithTenant\b[^}]*\}\s*from\s*"\.\.\/\.\.\/\.\.\/lib\/postgres\/client\.js"/);
});

test("findInviteByToken resolves the tenant via a narrow admin-scoped column lookup before reading the row", () => {
  const start = src.indexOf("async function findInviteByToken(");
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf("\n}", start));

  // The admin lookup selects exactly tenant_id, not the whole row - the
  // narrowest possible admin-privileged surface.
  assert.match(body, /queryAsAdmin\(\s*"SELECT tenant_id FROM invites WHERE invite_token = \$1/);

  // The admin lookup must run BEFORE the tenant-scoped read.
  const adminCallAt = body.indexOf("queryAsAdmin(");
  const withTenantCallAt = body.indexOf("withTenant(");
  assert.ok(adminCallAt > 0 && withTenantCallAt > adminCallAt, "admin lookup must precede the tenant-scoped read");

  // The real row read, and the ref.update write, both run inside
  // withTenant() - not on the admin identity.
  assert.equal((body.match(/withTenant\(tenantId,/g) || []).length, 2, "both the row read and ref.update must be tenant-scoped");
  assert.doesNotMatch(
    body.match(/ref:\s*\{[\s\S]*$/)[0],
    /queryAsAdmin/,
    "ref.update must never run on the admin identity",
  );
});
