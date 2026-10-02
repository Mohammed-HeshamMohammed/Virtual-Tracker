// Opening the organization Members tree runs three hierarchy repairs, each of which used to look
// up every member's role one database read at a time. ~80 people over a remote database was
// tens of seconds, and the page sat on its loading skeleton. They now work from one members
// read; this pins both the answers and that the per-member reads are gone.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoleKey } from "../src/http/role-key.js";

const counts = { perMemberRoleLookups: 0, memberReads: 0, removed: [] };

const ROLES = new Map([
  ["r-owner", "Owner"],
  ["r-admin", "Admin"],
  ["r-emp", "Employee"],
  ["r-client", "Client"],
]);

const members = [
  { id: "owner", role_id: "r-owner" },
  { id: "admin", role_id: "r-admin" },
  ...Array.from({ length: 78 }, (_, i) => ({ id: `emp${i}`, role_id: "r-emp" })),
  { id: "client", role_id: "r-client" },
  { id: "no-role", role_id: null },
];
const edges = [
  { parent_member_id: "owner", child_member_id: "admin" },
  ...Array.from({ length: 77 }, (_, i) => ({ parent_member_id: "admin", child_member_id: `emp${i}` })),
  // emp77 and no-role have no parent: an Employee with no parent is a violation
];

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
  namedExports: {
    listMembersPg: async () => {
      counts.memberReads += 1;
      return members;
    },
    getMemberByIdPg: async () => null,
    updateMemberPg: async () => null,
  },
});
mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: {
    resolveMemberRoleName: async () => {
      counts.perMemberRoleLookups += 1;
      return "Viewer";
    },
  },
});
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
    recordMemberRelationship: async () => null,
    removeMemberParentEdge: async () => 0,
    removeMemberHierarchyRelationships: async (_db, id) => {
      counts.removed.push(id);
      return 1;
    },
    getMemberParentId: async () => null,
  },
});
mock.module("../src/modules/hierarchy/hierarchy-sync.js", {
  namedExports: { syncMemberHierarchyStatus: async () => null },
});
mock.module("../src/modules/hierarchy/membership-entitlements.js", {
  namedExports: { hasIndependentHierarchyEntitlement: () => false },
});

const repair = await import("../src/modules/hierarchy/hierarchy-repair.js");

function reset() {
  counts.perMemberRoleLookups = 0;
  counts.memberReads = 0;
  counts.removed = [];
}

test("loadMembersWithRoleNames: a member's role, Viewer when it has none or an unknown one", async () => {
  reset();
  const { roleNameByMemberId } = await repair.loadMembersWithRoleNames(null);
  assert.equal(roleNameByMemberId.get("owner"), "Owner");
  assert.equal(roleNameByMemberId.get("emp3"), "Employee");
  assert.equal(roleNameByMemberId.get("no-role"), "Viewer");
  assert.equal(counts.memberReads, 1, "one members read for everybody");
});

test("finding orphans reads the members once and never looks a role up per member", async () => {
  reset();
  const violations = await repair.findOrphanHierarchyViolations(null);
  assert.equal(counts.perMemberRoleLookups, 0);
  assert.equal(counts.memberReads, 1);
  const ids = violations.map((v) => v.member_id);
  assert.ok(ids.includes("emp77"), "an Employee with no parent is still a violation");
  assert.equal(ids.includes("emp0"), false, "a placed Employee is not");
});

test("cleaning external entities touches only the excluded roles, with no per-member lookups", async () => {
  reset();
  const out = await repair.cleanupExternalEntityHierarchyEdges(null);
  assert.equal(counts.perMemberRoleLookups, 0);
  assert.deepEqual(counts.removed, ["client"], "only the Client is cleaned");
  assert.equal(out.members_cleaned, 1);
});

test("the organization root is the Owner, found without per-member lookups", async () => {
  reset();
  assert.equal(await repair.resolveOrganizationRootMemberId(null), "owner");
  assert.equal(counts.perMemberRoleLookups, 0);
});

test("owner-under-owner preview reads roles from the one members read", async () => {
  reset();
  const out = await repair.repairOwnerUnderOwnerRelationships(null, { dryRun: true });
  assert.equal(out.repaired, false);
  assert.equal(counts.perMemberRoleLookups, 0);
});
