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
  assert.match(handler, /"tree_parent_member_id"\]/, "the parent must be one of the inserted columns");
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
