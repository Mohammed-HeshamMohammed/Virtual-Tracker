// Wherever a Super Admin or Admin is placed in the hierarchy, they go under the Owner - not under
// whoever added them. recordMemberRelationship is the one place every placement passes through.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoleKey } from "../src/http/role-key.js";

const ROLE = { owner: "Owner", saA: "Super Admin", newSa: "Super Admin", newAdmin: "Admin", mgr: "Manager", emp: "Employee" };
const inserted = [];

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
    query: async (sql, params) => {
      if (sql.includes("INSERT INTO member_relationships")) {
        inserted.push({ parent: params[1], child: params[2], type: params[3] });
        return [{ id: params[0], parent_member_id: params[1], child_member_id: params[2] }];
      }
      return [];
    },
  },
});
mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: {
    getMemberByIdPg: async () => null,
    updateMemberPg: async () => null,
    listMembersPg: async () => [
      { id: "owner", role_id: "r-owner", date_added: "2026-01-01" },
      { id: "saA", role_id: "r-sa", date_added: "2026-02-01" },
    ],
  },
});
mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: { deleteMemberTreeCache: async () => null, getMemberTreeCache: async () => null, setMemberTreeCache: async () => null },
});
mock.module("../src/modules/presence/index.js", { namedExports: { sendToMember: () => null } });
mock.module("../src/modules/activity/activity-scope.js", { namedExports: { resolveMemberRoleName: async (_db, id) => ROLE[id] ?? "Viewer" } });
mock.module("../src/modules/members/services/relation-sync.js", {
  namedExports: {
    normalizeRoleKey,
    loadRoleNameById: async () => new Map([["r-owner", "Owner"], ["r-sa", "Super Admin"]]),
    rolePrivilegeRank: () => 0,
    ROLE_PRIVILEGE_RANK: {},
  },
});

const { recordMemberRelationship } = await import("../src/modules/member-relationships/service.js");
const placed = async (parentMemberId, childMemberId) => {
  inserted.length = 0;
  await recordMemberRelationship(null, { parentMemberId, childMemberId, relationshipType: "invite", createdBy: parentMemberId });
  return inserted[0];
};

test("a Super Admin added by another Super Admin is placed under the Owner", async () => {
  assert.deepEqual(await placed("saA", "newSa"), { parent: "owner", child: "newSa", type: "invite" });
});

test("an Admin added by a Super Admin or a Manager is placed under the Owner", async () => {
  assert.equal((await placed("saA", "newAdmin")).parent, "owner");
  assert.equal((await placed("mgr", "newAdmin")).parent, "owner");
});

test("an Admin added by the Owner stays where it was put", async () => {
  assert.equal((await placed("owner", "newAdmin")).parent, "owner");
});

test("everyone else is still placed under whoever added them", async () => {
  assert.equal((await placed("mgr", "emp")).parent, "mgr");
  assert.equal((await placed("saA", "mgr")).parent, "saA");
});

test("a role change to Super Admin or Admin re-parents under the Owner (and the tree load repairs old cases)", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const sync = read("src/modules/hierarchy/hierarchy-sync.js");
  assert.match(sync, /if \(isAdminTierRole\(nextRoleName\)\)/);
  assert.match(sync, /normalizeRoleKey\(parentRole\) !== "owner"/);
  assert.match(read("src/modules/member-relationships/routes.js"), /\["admins under the Owner", \(\) => maybeAnchorAdminsOnTreeLoad\(db, authz\.memberId\)\]/);
});
