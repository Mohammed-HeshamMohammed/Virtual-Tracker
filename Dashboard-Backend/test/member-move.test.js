// Moving a member under a different manager: the rules (pure) and the service that applies them.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoleKey } from "../src/http/role-key.js";
import { MOVE_ERROR, planMemberMove } from "../src/modules/member-relationships/move-plan.js";

const RANK = { owner: 100, superadmin: 90, admin: 80, supermanager: 70, manager: 60, teamlead: 50, employee: 40, intern: 30, client: 20, viewer: 10 };
const rankOf = (role) => RANK[normalizeRoleKey(role)] ?? 35;
const isExternal = (role) => normalizeRoleKey(role) === "client";

const ROLES = {
  owner: "Owner",
  admin: "Admin",
  sa: "Super Admin",
  mgrA: "Manager",
  mgrB: "Manager",
  empA: "Employee",
  empB: "Employee",
  intern: "Intern",
  client: "Client",
};
//  owner -> admin -> mgrA -> empA
//                 -> mgrB -> empB
const EDGES = [
  { parent_member_id: "owner", child_member_id: "admin" },
  { parent_member_id: "admin", child_member_id: "mgrA" },
  { parent_member_id: "admin", child_member_id: "mgrB" },
  { parent_member_id: "mgrA", child_member_id: "empA" },
  { parent_member_id: "mgrB", child_member_id: "empB" },
];

const plan = (memberId, newParentId, edges = EDGES) =>
  planMemberMove({ memberId, newParentId, edges, roleOf: (id) => ROLES[id], roleKey: normalizeRoleKey, rankOf, isExternal });

test("an Employee can move to another manager, and the plan remembers the previous one", () => {
  const out = plan("empA", "mgrB");
  assert.equal(out.ok, true);
  assert.equal(out.noop, false);
  assert.equal(out.previousParentId, "mgrA");
});

test("moving under the current manager is a no-op, not an error", () => {
  const out = plan("empA", "mgrA");
  assert.deepEqual(out, { ok: true, noop: true, previousParentId: "mgrA" });
});

test("a manager can move with their whole team", () => {
  assert.equal(plan("mgrA", "mgrB").ok, true, "equal rank is allowed");
});

test("nobody can be moved under themself or under their own team", () => {
  assert.equal(plan("mgrA", "mgrA").code, MOVE_ERROR.SELF);
  const cycle = plan("mgrA", "empA");
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, MOVE_ERROR.RANK, "an Employee cannot manage a Manager - refused on rank first");
  // A same-rank cycle: two managers, one under the other.
  const chain = [...EDGES, { parent_member_id: "mgrA", child_member_id: "mgrB" }].filter(
    (e) => !(e.parent_member_id === "admin" && e.child_member_id === "mgrB"),
  );
  const deep = plan("mgrA", "mgrB", chain);
  assert.equal(deep.code, MOVE_ERROR.CYCLE);
});

test("the Owner cannot be moved, and a Client is neither moved nor a manager", () => {
  assert.equal(plan("owner", "admin").code, MOVE_ERROR.OWNER);
  assert.equal(plan("client", "mgrA").code, MOVE_ERROR.EXTERNAL_CHILD);
  assert.equal(plan("empA", "client").code, MOVE_ERROR.EXTERNAL_PARENT);
});

test("a manager must outrank, or equal, the member", () => {
  assert.equal(plan("mgrA", "intern").code, MOVE_ERROR.RANK);
  assert.equal(plan("admin", "mgrA").code, MOVE_ERROR.RANK);
  assert.equal(plan("intern", "empA").ok, true);
});

test("Super Admins and Admins can only report to the Owner", () => {
  assert.equal(plan("admin", "sa").code, MOVE_ERROR.ADMIN_TO_OWNER, "an Admin cannot be put under a Super Admin");
  assert.equal(plan("sa", "admin").code, MOVE_ERROR.RANK, "refused on rank first");
  assert.equal(plan("admin", "owner").ok, true);
  assert.equal(plan("sa", "owner").ok, true);
  assert.equal(plan("mgrA", "sa").ok, true, "a Manager can still be moved under a Super Admin");
});

test("unknown members and missing input are refused", () => {
  assert.equal(plan("ghost", "mgrA").code, MOVE_ERROR.NOT_FOUND);
  assert.equal(plan("empA", "ghost").code, MOVE_ERROR.NOT_FOUND);
  assert.equal(plan("", "mgrA").code, MOVE_ERROR.INVALID);
});

test("a member with no manager yet can be given one", () => {
  const out = plan("empA", "mgrB", EDGES.filter((e) => e.child_member_id !== "empA"));
  assert.equal(out.ok, true);
  assert.equal(out.previousParentId, null);
});

// ---- the service -------------------------------------------------------------------------------

const calls = [];
let failRecordFor = null;
let edgesNow = EDGES.map((e, i) => ({ id: `e${i}`, ...e }));

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
    query: async () => edgesNow,
  },
});
mock.module("../src/modules/hierarchy/hierarchy-repair.js", {
  namedExports: {
    loadMembersWithRoleNames: async () => ({ roleNameByMemberId: new Map(Object.entries(ROLES)) }),
  },
});
mock.module("../src/modules/hierarchy/hierarchy-sync.js", {
  namedExports: {
    syncMemberHierarchyStatus: async (_db, id) => {
      calls.push(["status", id]);
    },
  },
});
mock.module("../src/modules/members/services/relation-sync.js", {
  namedExports: { normalizeRoleKey, rolePrivilegeRank: rankOf, ROLE_PRIVILEGE_RANK: RANK },
});
mock.module("../src/modules/member-relationships/service.js", {
  namedExports: {
    removeMemberParentEdge: async (_db, id) => {
      calls.push(["remove", id]);
      return 1;
    },
    recordMemberRelationship: async (_db, { parentMemberId, childMemberId }) => {
      calls.push(["record", parentMemberId, childMemberId]);
      if (failRecordFor === parentMemberId) throw new Error("insert failed");
      return {};
    },
  },
});

const { moveMemberToParent } = await import("../src/modules/member-relationships/move-service.js");

function reset() {
  calls.length = 0;
  failRecordFor = null;
}

test("service: a valid move drops the old edge, adds the new one, and refreshes the status", async () => {
  reset();
  const out = await moveMemberToParent(null, { memberId: "empA", newParentId: "mgrB", actorMemberId: "owner" });
  assert.deepEqual(out, { ok: true, moved: true, previousParentId: "mgrA", parentId: "mgrB" });
  assert.deepEqual(calls, [["remove", "empA"], ["record", "mgrB", "empA"], ["status", "empA"]]);
});

test("service: a refused move writes nothing", async () => {
  reset();
  const out = await moveMemberToParent(null, { memberId: "owner", newParentId: "admin", actorMemberId: "owner" });
  assert.equal(out.ok, false);
  assert.deepEqual(calls, []);
});

test("service: a no-op writes nothing", async () => {
  reset();
  const out = await moveMemberToParent(null, { memberId: "empA", newParentId: "mgrA", actorMemberId: "owner" });
  assert.equal(out.moved, false);
  assert.deepEqual(calls, []);
});

test("service: if adding the new edge fails, the previous manager is put back", async () => {
  reset();
  failRecordFor = "mgrB";
  await assert.rejects(moveMemberToParent(null, { memberId: "empA", newParentId: "mgrB", actorMemberId: "owner" }), /insert failed/);
  assert.deepEqual(calls, [["remove", "empA"], ["record", "mgrB", "empA"], ["record", "mgrA", "empA"]]);
});
