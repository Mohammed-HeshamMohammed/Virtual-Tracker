// PLAN-customer-accounts-and-tenancy.md §0.1 blocker 3: session-bootstrap is
// the first authenticated call after Firebase sign-in - a route reachable
// before any tenant is known, yet everything it does
// (ensureMemberLinkedRecordsForUserRecord, alignMemberRoleTables,
// getMemberByIdPg, ...) reads/writes tenant-scoped tables by memberId, not
// by tenant. Source-level, matching member-invites.routes.js's own
// established convention for this exact problem (see
// invite-token-tenant-lookup.test.js) - session-bootstrap.js's import graph
// (Firebase Admin, Firestore, several member-bootstrap services) is too
// heavy to usefully mock end-to-end for one narrow fix.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/modules/auth/session-bootstrap.js", import.meta.url), "utf8");

const resolver = readFileSync(new URL("../src/lib/postgres/tenant-resolution.js", import.meta.url), "utf8");

test("session-bootstrap resolves its tenant through the shared resolver and scopes with withTenant", () => {
  assert.match(src, /import\s*\{[^}]*\bresolveTenantIdForFirebaseUid\b[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/postgres\/tenant-resolution\.js"/);
  assert.match(src, /import\s*\{[^}]*\bwithTenant\b[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/postgres\/client\.js"/);
});

test("the shared resolver is a narrow admin-scoped lookup by firebase_uid over members and pending signups", () => {
  const start = resolver.indexOf("export async function resolveTenantIdForFirebaseUid(");
  assert.ok(start > 0);
  const body = resolver.slice(start, resolver.indexOf("\n}", start));
  assert.match(body, /queryAsAdmin\(/);
  assert.match(body, /SELECT tenant_id FROM members WHERE firebase_uid = \$1/);
  assert.match(body, /SELECT tenant_id FROM pending_auth_members WHERE firebase_uid = \$1/);
  assert.match(body, /MAIN_TENANT_ID/, "must fall back to the main tenant when no row is found");
});

test("the whole bootstrap (both the first attempt and the retry) runs inside withTenant, not just part of it", () => {
  const start = src.indexOf("const tenantId = await resolveTenantIdForFirebaseUid(decoded.uid);");
  assert.ok(start > 0, "tenant must be resolved before bootstrapMemberSession is ever called");
  const block = src.slice(start, src.indexOf("} catch (dbErr)", start));
  assert.equal(
    (block.match(/withTenant\(tenantId, bootstrapMemberSession\)/g) || []).length,
    2,
    "both the first attempt and the retry must run tenant-scoped",
  );
  assert.doesNotMatch(block, /^\s*await bootstrapMemberSession\(\);/m, "no call to bootstrapMemberSession should bypass withTenant");
});

test("auth-middleware publishes the tenant before the first member lookup", () => {
  const mw = readFileSync(new URL("../src/http/auth-middleware.js", import.meta.url), "utf8");
  const publishAt = mw.indexOf("setRequestTenantId(await resolveTenantIdForFirebaseUid(decoded.uid));");
  const lookupAt = mw.indexOf("await getMemberAuthContextPg(decoded.uid)");
  assert.ok(publishAt > 0 && lookupAt > publishAt, "tenant must be published before getMemberAuthContextPg runs");
});
