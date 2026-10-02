// Super Admins and Admins report straight to the Owner: the pure rules, and the repair that moves
// the ones who do not (a Super Admin added by another Super Admin, or promoted after being added).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoleKey } from "../src/http/role-key.js";

const ROLES = new Map([["r-owner", "Owner"], ["r-sa", "Super Admin"], ["r-admin", "Admin"], ["r-emp", "Employee"]]);
const members = [
  { id: "owner", role_id: "r-owner", date_added: "2026-01-01" },
  { id: "owner2", role_id: "r-owner", date_added: "2026-06-01" },
  { id: "saA", role_id: "r-sa", date_added: "2026-02-01" }, // already under the Owner
  { id: "saB", role_id: "r-sa", date_added: "2026-03-01" }, // under saA: the case from the screenshot
  { id: "adminC", role_id: "r-admin", date_added: "2026-03-02" }, // under saB: two levels down
  { id: "adminD", role_id: "r-admin", date_added: "2026-03-03" }, // no manager at all
  { id: "emp", role_id: "r-emp", date_added: "2026-04-01" }, // under saB, must not move
];
const edges = [
  { parent_member_id: "owner", child_member_id: "saA" },
  { parent_member_id: "saA", child_member_id: "saB" },
  { parent_member_id: "saB", child_member_id: "adminC" },
  { parent_member_id: "saB", child_member_id: "emp" },
];
const calls = [];

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    getPostgresPool: () => null,
    getAdminPostgresPool: () => null,
    queryAsAdmin: async () => [],
    queryRaw: async () => ({ rows: [] }),
    withTenant: async (_t, fn) => fn(),
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn(),
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
    query: async (sql) => (sql.includes("member_relationships") ? edges : []),
  },
});
mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: { listMembersPg: async () => members, getMemberByIdPg: async () => null, updateMemberPg: async () => null },
});
mock.module("../src/modules/activity/activity-scope.js", { namedExports: { resolveMemberRoleName: async () => "Viewer" } });
mock.module("../src/modules/members/services/relation-sync.js", {
  namedExports: {
    loadRoleNameById: async () => ROLES,
    normalizeRoleKey,
    pickHighestPrivilegeRoleName: (names) => names.find((n) => n) || "Viewer",
    syncMemberPrimaryRole: async () => null,
    rolePrivilegeRank: () => 0,
    ROLE_PRIVILEGE_RANK: {},
  },
});
mock.module("../src/modules/member-relationships/service.js", {
  namedExports: {
    recordMemberRelationship: async (_db, { parentMemberId, childMemberId }) => {
      calls.push(["record", parentMemberId, childMemberId]);
      return {};
    },
    removeMemberParentEdge: async (_db, id) => {
      calls.push(["remove", id]);
      return 1;
    },
    removeMemberHierarchyRelationships: async () => 0,
    getMemberParentId: async () => null,
  },
});
mock.module("../src/modules/hierarchy/hierarchy-sync.js", {
  namedExports: {
    syncMemberHierarchyStatus: async (_db, id) => {
      calls.push(["status", id]);
    },
  },
});
mock.module("../src/modules/hierarchy/membership-entitlements.js", { namedExports: { hasIndependentHierarchyEntitlement: () => false } });

const anchor = await import("../src/modules/hierarchy/admin-anchor.js");
const repair = await import("../src/modules/hierarchy/hierarchy-repair.js");

const roleNameById = (id) => ROLES.get(members.find((m) => m.id === id)?.role_id);
const parentOf = new Map(edges.map((e) => [e.child_member_id, e.parent_member_id]));

test("isAdminTierRole: Super Admin and Admin only", () => {
  for (const role of ["Super Admin", "Admin", "super admin"]) assert.equal(anchor.isAdminTierRole(role), true, role);
  for (const role of ["Owner", "Manager", "Employee", "Client", "", undefined]) assert.equal(anchor.isAdminTierRole(role), false, String(role));
});

test("ownerFor: the Owner already above them, else the oldest Owner", () => {
  assert.equal(anchor.ownerFor("saB", parentOf, roleNameById, ["owner", "owner2"]), "owner", "found by walking up through saA");
  assert.equal(anchor.ownerFor("adminD", parentOf, roleNameById, ["owner", "owner2"]), "owner", "no manager: the oldest Owner");
  assert.equal(anchor.ownerFor("owner", new Map(), roleNameById, ["owner", "owner2"]), "owner2", "never themself");
  assert.equal(anchor.ownerFor("adminD", parentOf, roleNameById, []), null);
});

test("findOwnerIds: Owners only, oldest first", async () => {
  assert.deepEqual(await anchor.findOwnerIds(null), ["owner", "owner2"]);
  assert.equal(await anchor.findPrimaryOwnerId(null), "owner");
  assert.equal(await anchor.findPrimaryOwnerId(null, "owner"), "owner2");
});

test("planAdminAnchors: only admins not already directly under an Owner", () => {
  const plan = anchor.planAdminAnchors({ memberIds: members.map((m) => m.id), roleOf: roleNameById, parentOf, ownerIds: ["owner", "owner2"] });
  assert.deepEqual(
    plan.map((p) => [p.memberId, p.ownerId, p.fromParentId]),
    [["saB", "owner", "saA"], ["adminC", "owner", "saB"], ["adminD", "owner", null]],
  );
});

test("anchorAdminsToOwner moves exactly those, edge by edge, and leaves their teams alone", async () => {
  calls.length = 0;
  const dry = await repair.anchorAdminsToOwner(null, { dryRun: true });
  assert.equal(dry.plan.length, 3);
  assert.deepEqual(calls, [], "a dry run writes nothing");

  const out = await repair.anchorAdminsToOwner(null, { actorMemberId: "owner" });
  assert.deepEqual(out.moved, ["saB", "adminC", "adminD"]);
  assert.deepEqual(calls.filter((c) => c[0] === "record"), [["record", "owner", "saB"], ["record", "owner", "adminC"], ["record", "owner", "adminD"]]);
  assert.equal(calls.some((c) => c[1] === "emp" || c[2] === "emp"), false, "an Employee under a moved admin is untouched");
});
