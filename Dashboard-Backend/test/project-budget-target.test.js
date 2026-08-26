// Guards the live budget total for scope='per_person' rows. `cost` on such a
// row is hours-per-member, NOT the project cap - reading it raw is what made
// the stop-timer gate and the notify threshold fire at 1/headcount of the real
// budget (item 7 of agent-ux-fixes-plan.md).
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ rows: Record<string, unknown[]>, payRates: Record<string, number> }} */
const stub = { rows: {}, payRates: {} };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    query: async (sql) => {
      if (sql.includes("FROM project_members")) return stub.rows.projectMembers ?? [];
      if (sql.includes("FROM client_projects")) return stub.rows.clientProjects ?? [];
      if (sql.includes("FROM client_budgets")) return stub.rows.clientBudgets ?? [];
      return [];
    },
    __closePostgresPoolForTests: async () => null,
    getPostgresPool: async () => null,
    isPostgresConfigured: () => true,
    probePostgresReadiness: async () => null,
    withTransaction: async () => null,
  },
});

mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: {
    getSingleByMemberId: async (_db, _collection, memberId) => ({
      rate: stub.payRates[memberId] ?? 0,
    }),
    createMemberBanRecord: async () => null,
    deleteLimitsDoc: async () => null,
    deleteMemberScopedRows: async () => null,
    deleteMemberTreeCache: async () => null,
    ensureLimitsDoc: async () => null,
    ensureSingleByMemberId: async () => null,
    fetchWeeklyLimitsForMembers: async () => null,
    findActiveBanByEmail: async () => null,
    findActiveBanByFirebaseUid: async () => null,
    findActiveBanByMemberId: async () => null,
    getMemberBanRecord: async () => null,
    getMemberLimitHours: async () => null,
    getMemberLimitsDoc: async () => null,
    getMemberTreeCache: async () => null,
    getSystemMetaDoc: async () => null,
    isDevicePermanentlyBanned: async () => null,
    listActiveMemberBans: async () => [],
    memberUsesShiftsForLimits: async () => null,
    patchMemberBanRecord: async () => null,
    recordBanIpAndMaybeDeviceBan: async () => null,
    setMemberTreeCache: async () => null,
    setSystemMetaDoc: async () => null,
    updateWorkLimitsConditional: async () => null,
    upsertLimitField: async () => null,
    upsertSingleByMemberId: async () => null,
    upsertSingleByMemberIdConditional: async () => null,
  },
});

mock.module("../src/lib/postgres/clients-postgres.service.js", {
  namedExports: {
    getClientBudgetPg: async () => null,
    createClientPg: async () => null,
    deleteClientBudgetPg: async () => null,
    deleteClientPg: async () => null,
    getAllClientBudgetsPg: async () => [],
    getClientAutomationStatePg: async () => null,
    getClientInvoicingPg: async () => null,
    getClientPg: async () => null,
    listClientsPg: async () => [],
    updateClientPg: async () => null,
    upsertClientAutomationStatePg: async () => null,
    upsertClientBudgetPg: async () => null,
    upsertClientInvoicingPg: async () => null,
  },
});

const { computeProjectBudgetTargetPg } = await import(
  "../src/lib/postgres/projects-postgres.service.js"
);

test("per_project: the cap is `cost`, untouched", async () => {
  stub.rows = {};
  const cap = await computeProjectBudgetTargetPg(null, "p1", {
    type: "Hours based",
    scope: "per_project",
    cost: 10,
  });
  assert.equal(cap, 10);
});

test("per_person Hours based: cap is hours-per-member x current headcount", async () => {
  stub.rows = {
    projectMembers: [
      { project_id: "p1", member_id: "m1" },
      { project_id: "p1", member_id: "m2" },
      { project_id: "p1", member_id: "m3" },
    ],
  };
  const cap = await computeProjectBudgetTargetPg(null, "p1", {
    type: "Hours based",
    scope: "per_person",
    cost: 10,
  });
  assert.equal(cap, 30);
});

test("per_person with no members yet: cap is 0, not the per-person figure", async () => {
  stub.rows = { projectMembers: [] };
  const cap = await computeProjectBudgetTargetPg(null, "p1", {
    type: "Hours based",
    scope: "per_person",
    cost: 10,
  });
  assert.equal(cap, 0);
});

test("per_person Cost based on pay rate: each member's own rate x the shared hours target", async () => {
  stub.rows = {
    projectMembers: [
      { project_id: "p1", member_id: "m1" },
      { project_id: "p1", member_id: "m2" },
    ],
  };
  stub.payRates = { m1: 20, m2: 30 };
  const cap = await computeProjectBudgetTargetPg(null, "p1", {
    type: "Cost based",
    based_on: "Pay rate",
    scope: "per_person",
    cost: 10,
  });
  assert.equal(cap, 500); // 10h x 20 + 10h x 30
});

test("missing budget row is 0, not NaN", async () => {
  assert.equal(await computeProjectBudgetTargetPg(null, "p1", null), 0);
});
