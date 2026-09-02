// Guards two things about the Pay/Bill tab's payBill save path
// (member-profile.service.js's updateMemberProfile):
//
// 1. Only Super Manager and above (isOrgProjectAdminRole) may change a
//    member's pay/bill rate - narrower than the Manager+ tier every other
//    profile section allows, and enforced here (not just at the HTTP route)
//    because this is the one function every payBill write actually funnels
//    through, including members/batch-update, which never had its own
//    payBill-specific check at all.
// 2. Every accepted change appends one row to pay_rate_history (previous
//    values captured, changed-by resolved), so the Pay/Bill tab's "history"
//    table has real rows instead of fabricating a single "Current" row from
//    whatever pay_rates currently holds - a no-op re-save of identical
//    values does not manufacture a fake history entry.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{
 *   members: Record<string, any>,
 *   actorRoleName: string,
 *   existingPayRate: Record<string, any> | null,
 *   upsertConflict: boolean,
 *   insertedHistory: Record<string, any>[],
 *   listedHistory: Record<string, any>[],
 * }} */
const stub = {
  members: {},
  actorRoleName: "",
  existingPayRate: null,
  upsertConflict: false,
  insertedHistory: [],
  listedHistory: [],
};

function reset() {
  stub.members = {};
  stub.actorRoleName = "";
  stub.existingPayRate = null;
  stub.upsertConflict = false;
  stub.insertedHistory = [];
  stub.listedHistory = [];
}

// --- every direct import of member-profile.service.js, stubbed -----------

mock.module("../src/lib/postgres/member-form-snapshot-postgres.service.js", {
  namedExports: {
    upsertMemberFormSnapshotPg: async () => undefined,
    deleteMemberFormSnapshotPg: async () => undefined,
  },
});
mock.module("../src/modules/realtime/change-bus.js", {
  namedExports: { publishChange: async () => undefined },
});
mock.module("../src/modules/members/services/member-entity-bootstrap.js", {
  namedExports: { ensureMemberScopedEntities: async () => undefined },
});
mock.module("../src/modules/members/services/member-presence.service.js", {
  namedExports: { enrichMemberWithPresence: async (row) => row },
});
mock.module("../src/modules/members/services/relation-sync.js", {
  namedExports: {
    alignMemberRoleTables: async () => undefined,
    loadRoleNameById: async () => new Map(),
    pickCanonicalPrimaryRoleName: () => ({ name: "" }),
    syncMemberPrimaryRole: async () => undefined,
  },
});
mock.module("../src/modules/members/services/member-role-change.service.js", {
  namedExports: {
    getProfilePatchSections: (body) => Object.keys(body).filter((k) => k !== "expected_updated_at"),
    profilePatchNeedsBootstrap: (body) => Boolean(body.employment && typeof body.employment === "object"),
  },
});
mock.module("../src/http/role-owner-policy.js", {
  namedExports: { validateOwnerRoleChange: () => null },
});
mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: {
    resolveMemberRoleName: async (_db, memberId) => stub.actorRoleName,
  },
});
mock.module("../src/http/auth-context.js", {
  namedExports: {
    isManagementRole: (role) =>
      ["owner", "superadmin", "admin", "supermanager", "supermanger", "manager"].includes(
        String(role || "").trim().toLowerCase(),
      ),
  },
});
mock.module("../src/http/team-member-assign-policy.js", {
  namedExports: { isEmployeeL2OrHigherRole: () => true },
});
mock.module("../src/lib/postgres/lookup-postgres.service.js", {
  namedExports: {
    lookupNameByIdPg: async () => "",
    resolveLookupIdByNamePg: async () => "",
  },
});
mock.module("../src/modules/members/services/shift-allowance-feature.js", {
  namedExports: {
    assertShiftAllowanceAllowed: () => undefined,
    normalizeShiftAllowanceFlag: () => false,
    SHIFT_ALLOWANCE_LIMITS_ENABLED: false,
  },
});
mock.module("../src/modules/members/services/member-display-name.js", {
  namedExports: { validateMemberNamePart: () => null },
});
mock.module("../src/http/validate-body.js", {
  namedExports: { assertValidPhone: async (v) => v },
});
mock.module("../src/modules/auth/profile-settings.js", {
  namedExports: { syncUserProfilePhoneForUid: async () => undefined },
});
mock.module("../src/modules/auth/profile-collection-name.js", {
  namedExports: { USER_PROFILES_COLLECTION: "user_profiles" },
});
mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: {
    getMemberByIdPg: async (id) => stub.members[id] ?? null,
    updateMemberPg: async () => undefined,
  },
});
mock.module("../src/lib/postgres/client.js", {
  namedExports: { query: async () => [] },
});
mock.module("../src/lib/postgres/member-data-postgres.service.js", {
  namedExports: {
    deleteMemberOnboardingByMemberIdPg: async () => undefined,
    deletePayRateHistoryByMemberIdPg: async () => undefined,
    insertPayRateHistoryRowPg: async (payload) => {
      stub.insertedHistory.push(payload);
      return "hist-" + stub.insertedHistory.length;
    },
    listPayRateHistoryByMemberIdPg: async () => stub.listedHistory,
  },
});
mock.module("../src/http/project-access.js", {
  namedExports: {
    // Real production set (project-access.js's own ORG_PROJECT_TASK_ADMIN_ROLES) -
    // duplicated here deliberately so this test exercises what the gate
    // *does* with whatever isOrgProjectAdminRole answers, not that answer's
    // own correctness.
    isOrgProjectAdminRole: (role) =>
      ["owner", "superadmin", "admin", "supermanager", "supermanger"].includes(
        String(role || "").trim().toLowerCase().replace(/\s+/g, ""),
      ),
  },
});
mock.module("../src/lib/postgres/member-data-store.js", {
  namedExports: {
    deleteLimitsDoc: async () => undefined,
    deleteMemberScopedRows: async () => undefined,
    getMemberLimitsDoc: async () => null,
    getSingleByMemberId: async (_db, collection) =>
      collection === "pay_rates" ? stub.existingPayRate : null,
    updateWorkLimitsConditional: async () => ({}),
    upsertLimitField: async () => undefined,
    upsertSingleByMemberId: async () => "row-id",
    upsertSingleByMemberIdConditional: async () =>
      stub.upsertConflict ? { conflict: true } : "row-id",
  },
});

const { updateMemberProfile, getMemberProfileFormSections } = await import(
  "../src/modules/members/services/member-profile.service.js"
);

const MEMBER_ID = "member-1";
const MANAGER_ACTOR = "actor-manager";
const SUPERMANAGER_ACTOR = "actor-supermanager";

function seedMember(id, first, last) {
  stub.members[id] = { id, first_name: first, last_name: last };
}

test("a Manager actor is refused - the gate is Super Manager and above, not Manager+", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  seedMember(MANAGER_ACTOR, "Mandy", "Manager");
  stub.actorRoleName = "Manager";

  await assert.rejects(
    () =>
      updateMemberProfile(
        null,
        MEMBER_ID,
        { payBill: { payRate: "50", currency: "USD", payPeriod: "None" } },
        MANAGER_ACTOR,
      ),
    /Super Manager/,
  );
  assert.equal(stub.insertedHistory.length, 0, "no history row on a refused save");
});

test("a Super Manager actor is allowed", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  seedMember(SUPERMANAGER_ACTOR, "Sam", "Supermanager");
  stub.actorRoleName = "Super Manager";
  stub.existingPayRate = null;

  await assert.doesNotReject(() =>
    updateMemberProfile(
      null,
      MEMBER_ID,
      { payBill: { payRate: "50", currency: "USD", payPeriod: "None" } },
      SUPERMANAGER_ACTOR,
    ),
  );
});

test("an Owner actor is allowed", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  seedMember("actor-owner", "Olivia", "Owner");
  stub.actorRoleName = "Owner";

  await assert.doesNotReject(() =>
    updateMemberProfile(null, MEMBER_ID, { payBill: { payRate: "75" } }, "actor-owner"),
  );
});

test("a real change writes one history row with the previous values captured", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  seedMember(SUPERMANAGER_ACTOR, "Sam", "Supermanager");
  stub.actorRoleName = "Super Manager";
  stub.existingPayRate = { rate: 40, currency: "USD", pay_period: "None", note: "", effective_date: "2026-01-01" };

  await updateMemberProfile(
    null,
    MEMBER_ID,
    { payBill: { payRate: "55", currency: "USD", payPeriod: "Weekly", note: "Raise", effectiveDate: "2026-02-01" } },
    SUPERMANAGER_ACTOR,
  );

  assert.equal(stub.insertedHistory.length, 1);
  const row = stub.insertedHistory[0];
  assert.equal(row.member_id, MEMBER_ID);
  assert.equal(row.rate, 55);
  assert.equal(row.previous_rate, 40);
  assert.equal(row.pay_period, "Weekly");
  assert.equal(row.previous_pay_period, "None");
  assert.equal(row.note, "Raise");
  assert.equal(row.changed_by_member_id, SUPERMANAGER_ACTOR);
  assert.equal(row.changed_by_name, "Sam Supermanager");
});

test("re-saving the exact same values does not manufacture a fake history entry", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  seedMember(SUPERMANAGER_ACTOR, "Sam", "Supermanager");
  stub.actorRoleName = "Super Manager";
  stub.existingPayRate = { rate: 40, currency: "USD", pay_period: "None", note: "", effective_date: "2026-01-01" };

  await updateMemberProfile(
    null,
    MEMBER_ID,
    { payBill: { payRate: "40", currency: "USD", payPeriod: "None", note: "", effectiveDate: "2026-01-01" } },
    SUPERMANAGER_ACTOR,
  );

  assert.equal(stub.insertedHistory.length, 0);
});

test("a member's very first rate (no existing pay_rates row) still writes history, previousRate null", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  seedMember(SUPERMANAGER_ACTOR, "Sam", "Supermanager");
  stub.actorRoleName = "Super Manager";
  stub.existingPayRate = null;

  await updateMemberProfile(null, MEMBER_ID, { payBill: { payRate: "30" } }, SUPERMANAGER_ACTOR);

  assert.equal(stub.insertedHistory.length, 1);
  assert.equal(stub.insertedHistory[0].previous_rate, null);
});

test("self-edit: a Super Manager changing their own rate resolves changed-by from their own record", async () => {
  reset();
  seedMember(SUPERMANAGER_ACTOR, "Sam", "Supermanager");
  stub.actorRoleName = "Super Manager";
  stub.existingPayRate = { rate: 60, currency: "USD", pay_period: "None" };

  await updateMemberProfile(
    null,
    SUPERMANAGER_ACTOR,
    { payBill: { payRate: "65" } },
    SUPERMANAGER_ACTOR,
  );

  assert.equal(stub.insertedHistory[0].changed_by_name, "Sam Supermanager");
});

test("getMemberProfileFormSections maps pay_rate_history rows into the payBill section, most-recent-first order preserved", async () => {
  reset();
  seedMember(MEMBER_ID, "Target", "Member");
  stub.listedHistory = [
    {
      id: "h2",
      rate: 55,
      currency: "USD",
      pay_period: "Weekly",
      effective_date: "2026-02-01",
      note: "Raise",
      previous_rate: 40,
      changed_by_name: "Sam Supermanager",
      created_at: new Date("2026-02-01T00:00:00.000Z"),
    },
    {
      id: "h1",
      rate: 40,
      currency: "USD",
      pay_period: "None",
      effective_date: "2026-01-01",
      note: "",
      previous_rate: null,
      changed_by_name: "Owen Owner",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];

  const form = await getMemberProfileFormSections(null, MEMBER_ID, ["payBill"]);

  assert.equal(form.payRateHistory.length, 2);
  assert.equal(form.payRateHistory[0].id, "h2");
  assert.equal(form.payRateHistory[0].rate, 55);
  assert.equal(form.payRateHistory[0].previousRate, 40);
  assert.equal(form.payRateHistory[0].changedByName, "Sam Supermanager");
  assert.equal(form.payRateHistory[1].id, "h1");
  assert.equal(form.payRateHistory[1].previousRate, null);
});
