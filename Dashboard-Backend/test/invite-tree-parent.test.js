// "Add member here" from the member tree (PLAN-bug-fixes-round-1.md item 16).
// Source-level: the bulk-invite and invite-register handlers sit inside
// route modules whose import graph is most of the backend, and what matters
// here is ordering - the scope check has to run before the parent is stored.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("bulk invites only store a tree parent the inviter can manage", () => {
  const src = read("src/modules/compat/routes.js");
  const start = src.indexOf('url.pathname === "/api/invites/bulk"');
  assert.ok(start > 0);
  const handler = src.slice(start, src.indexOf("parseWithVersion(url.pathname, \"member-invites\")", start));

  const check = handler.indexOf("canManageMember(db, viewer?.memberId, viewer?.roleName, candidate)");
  const assign = handler.indexOf("treeParentMemberId = candidate");
  const insert = handler.indexOf("INSERT INTO invites");
  assert.ok(check > 0, "the requested parent must be scope-checked");
  assert.ok(check < assign && assign < insert, "scope check -> assignment -> insert, in that order");
  assert.match(handler, /"tree_parent_member_id","tenant_id"\]/, "the parent must be one of the inserted columns");
  assert.match(handler, /parentRoleKey === "client"/, "a client can never be the parent");
});

test("invite acceptance places the member under the stored tree parent", () => {
  const src = read("src/modules/members/routes/member-invites.routes.js");
  assert.match(src, /async function resolveInviteTreeParent\(row, inviterMemberId\)/);
  // Falls back to the inviter when the chosen parent has left since.
  assert.match(src, /return rows\.length \? treeParent : inviterMemberId/);
  assert.match(src, /const parentMemberId = await resolveInviteTreeParent\(row, inviterMemberId\);\s*await recordMemberRelationship\(db, \{\s*parentMemberId,/);
});

test("the invites table gets the tree parent column on boot", () => {
  const src = read("src/lib/postgres/ensure-lookup-schema.js");
  assert.match(src, /ALTER TABLE invites ADD COLUMN IF NOT EXISTS tree_parent_member_id UUID/);
});

test("every invite-creating path stamps the inviter's tenant and takes a seat", () => {
  // Left to the column DEFAULT (the main tenant), a customer account's own
  // invites enrolled people into the main organization.
  const compat = read("src/modules/compat/routes.js");
  const invites = read("src/modules/members/routes/member-invites.routes.js");
  assert.match(compat, /tenant_id: viewer\?\.tenantId \|\| MAIN_TENANT_ID/, "single POST /api/invites");
  assert.match(compat, /const inviteTenantId = viewer\?\.tenantId \|\| MAIN_TENANT_ID/, "bulk invites");
  assert.match(invites, /tenant_id: viewer\?\.tenantId \|\| MAIN_TENANT_ID/, "open-link invites");
  assert.match(invites, /const preprovisionTenantId = viewer\?\.tenantId \|\| MAIN_TENANT_ID/, "preprovision");
  assert.match(read("src/modules/members/routes/member-migration.routes.js"), /viewer\.tenantId \|\| MAIN_TENANT_ID\]/, "migrate");

  // Each path runs the seat guard: 2 in compat, and in member-invites the
  // open link, register, promotion (covers migrate) and preprovision.
  assert.equal((compat.match(/await withSeatsAvailable\(/g) || []).length, 2);
  assert.equal((invites.match(/await withSeatsAvailable\(/g) || []).length, 4);
});
