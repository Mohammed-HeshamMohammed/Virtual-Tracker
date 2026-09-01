// Guards buildAgentWorkspace's entitlement rules - which of the four
// sections a given viewer gets back. This is the security-relevant half of
// the agent workspace endpoint: the desktop app renders whatever sections
// arrive and has no role logic of its own, so a section leaking into the
// wrong payload here is a section that role can actually see.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ ledTeamIds: Set<string>, visibleMemberIds: string[] | null, queries: string[] }} */
const stub = { ledTeamIds: new Set(), visibleMemberIds: null, queries: [] };

mock.module("../src/lib/postgres/client.js", {
  namedExports: {
    // mock.module replaces the whole namespace, so every export anything in
    // the transitive import chain touches has to exist here, not just query.
    getPostgresPool: () => null,
    isPostgresConfigured: () => true,
    withTransaction: async (fn) => fn(),
    probePostgresReadiness: async () => true,
    __closePostgresPoolForTests: async () => {},
    query: async (sql) => {
      stub.queries.push(sql);
      if (sql.includes("FROM timesheets") && sql.includes("COUNT(*)")) return [{ pending: 3 }];
      if (sql.includes("FROM timesheets")) return [];
      if (sql.includes("FROM pay_rates")) return [{ rate: 50, currency: "USD" }];
      if (sql.includes("FROM members m")) {
        return [
          { member_id: "t1", name: "Ada", tracking_now: true, on_break: false, active_seconds_today: 3600 },
          { member_id: "t2", name: "Grace", tracking_now: false, on_break: false, active_seconds_today: 0 },
          { member_id: "t3", name: "Alan", tracking_now: false, on_break: true, active_seconds_today: 1800 },
        ];
      }
      if (sql.includes("FROM activity_sessions s")) {
        return [{ active_seconds: 7200, tracking_now: 2, members_worked: 5 }];
      }
      return [];
    },
  },
});
mock.module("../src/http/team-edit-access.js", {
  namedExports: {
    getTeamIdsLedByMember: async () => stub.ledTeamIds,
    canEditTeam: async () => false,
    resolveTeamIdFromWrite: () => "",
    teamHasMembers: async () => false,
    isProjectOnTeam: async () => false,
    canAssignMemberToTeamRoster: async () => false,
    canManageAllTeams: () => false,
    getOrgWideEmployeeMemberIds: async () => [],
    getTeamStaffableMemberIds: async () => [],
    getTeamStaffableMemberSummaries: async () => [],
    isManagerRole: () => false,
    isManagerTeamStaffableMember: async () => false,
    isMemberOnTeam: async () => false,
  },
});
// Wide fan-in (task-assignments.js pulls this in transitively), so every
// export has to exist even though only getVisibleMemberIds is meaningful here.
mock.module("../src/modules/member-relationships/service.js", {
  namedExports: {
    getVisibleMemberIds: async () => stub.visibleMemberIds,
    filterTeamScopeEdges: () => [],
    repairMemberRelationshipIntegrity: async () => null,
    recordMemberRelationship: async () => null,
    removeMemberParentEdge: async () => null,
    removeMemberHierarchyRelationships: async () => null,
    resolveAvatarUrlsForMembers: async () => [],
    getMemberParentId: async () => null,
    getMemberAncestors: async () => [],
    getMemberDescendants: async () => [],
    getMemberTreePath: async () => [],
    isAncestorOf: async () => false,
    getMemberRoot: async () => null,
    getConnectedMembers: async () => [],
    getMembersBySharedProjects: async () => [],
    getVisibleMembersForClient: async () => [],
    getTeamSubtreeMemberIds: async () => [],
    getManagerVisibleMemberIds: async () => [],
    getManagerPeoplePageVisibleMemberIds: async () => [],
    getManageableMemberIds: async () => [],
    getEmployeeHierarchyMemberIds: async () => [],
    buildMemberTree: async () => null,
    updateTreeCache: async () => null,
    resetMemberRelationshipsCacheForTests: () => {},
  },
});
mock.module("../src/lib/postgres/time-off-postgres.service.js", {
  namedExports: {
    getTimeOffBalanceRowsPg: async () => [
      { policyName: "Annual leave", balanceDays: 12.5, entitlementDays: 20, memberId: "m1", policyId: "p1", accruedDays: 20, usedDays: 7.5 },
    ],
    getTimeOffTransactionRowsPg: async () => [],
  },
});
// Same whole-namespace rule - timer-limit.service.js (imported for
// currentDayRange) pulls several of these in statically.
mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: {
    sumMemberActiveIdleSeconds: async () => ({ activeSeconds: 3600, idleSeconds: 0 }),
    insertActivityScreenshot: async () => null,
    insertActivityAppLog: async () => null,
    insertActivityUrlLog: async () => null,
    fetchPgScreenshots: async () => null,
    fetchPgAppLogs: async () => null,
    fetchPgUrlLogs: async () => null,
    sumAppLogSecondsByAppNamePg: async () => null,
    sumUrlLogSecondsByDomainPg: async () => null,
    findUnclassifiedAppsPg: async () => null,
    findUnclassifiedDomainsPg: async () => null,
    fetchPgScreenshotById: async () => null,
    fetchLatestPgScreenshot: async () => null,
    findOpenPgSession: async () => null,
    getPgSessionById: async () => null,
    createPgSession: async () => null,
    updatePgSession: async () => null,
    sumDailyMemberActiveSeconds: async () => 0,
    sumMemberActiveIdleSecondsForProject: async () => ({ activeSeconds: 0, idleSeconds: 0 }),
    sumDailyMemberTaskActiveSeconds: async () => 0,
    sumDailyMemberTaskActiveSecondsRange: async () => 0,
    fetchPgSessionsForDashboard: async () => [],
    fetchAllOpenPgSessions: async () => [],
    wasPgAlertSentRecently: async () => false,
    recordPgAlertSent: async () => null,
    reassignPgActivityMemberId: async () => null,
  },
});

const { buildAgentWorkspace } = await import("../src/modules/activity/workspace.service.js");

function reset() {
  stub.ledTeamIds = new Set();
  stub.visibleMemberIds = null;
  stub.queries = [];
}

const EMPLOYEE = { memberId: "m1", roleName: "Employee" };
const INTERN = { memberId: "m2", roleName: "Intern" };
const TEAM_LEAD = { memberId: "m3", roleName: "Team Lead" };
const MANAGER = { memberId: "m4", roleName: "Manager" };
const SUPER_MANAGER = { memberId: "m5", roleName: "Super Manager" };
const CLIENT = { memberId: "c1", roleName: "Client" };

test("an Employee gets only the self section", async () => {
  reset();
  const ws = await buildAgentWorkspace(null, EMPLOYEE);
  assert.ok(ws.self, "self is always present");
  assert.equal(ws.team, null, "leads nothing");
  assert.equal(ws.approvals, null, "not management");
  assert.equal(ws.pulse, null, "not an org admin");
});

test("an Intern gets the same shape as an Employee - no separate entitlement", async () => {
  reset();
  const ws = await buildAgentWorkspace(null, INTERN);
  assert.ok(ws.self);
  assert.equal(ws.team, null);
  assert.equal(ws.approvals, null);
  assert.equal(ws.pulse, null);
});

test("a Client gets the self section too - they can track on an opted-in project, so they have their own standing", async () => {
  reset();
  const ws = await buildAgentWorkspace(null, CLIENT);
  assert.ok(ws.self);
  assert.equal(ws.team, null);
  assert.equal(ws.approvals, null);
  assert.equal(ws.pulse, null);
});

test("the team section is gated on actually leading a team, not on the role name", async () => {
  reset();
  // A Team Lead who leads nothing gets no panel...
  const withoutTeams = await buildAgentWorkspace(null, TEAM_LEAD);
  assert.equal(withoutTeams.team, null);

  // ...and the same person does once they lead one.
  reset();
  stub.ledTeamIds = new Set(["team-1"]);
  const withTeams = await buildAgentWorkspace(null, TEAM_LEAD);
  assert.ok(withTeams.team, "leading a team is what grants the panel");
  assert.equal(withTeams.team.teamCount, 1);
});

test("a Manager flagged as a team lead gets the team panel too - the flag is the entitlement", async () => {
  reset();
  stub.ledTeamIds = new Set(["team-1", "team-2"]);
  const ws = await buildAgentWorkspace(null, MANAGER);
  assert.ok(ws.team);
  assert.equal(ws.team.teamCount, 2);
});

test("the team panel counts tracking / not-started / total from the member rows", async () => {
  reset();
  stub.ledTeamIds = new Set(["team-1"]);
  const ws = await buildAgentWorkspace(null, TEAM_LEAD);
  assert.equal(ws.team.members.length, 3);
  assert.equal(ws.team.trackingNowCount, 1, "only Ada is actively tracking");
  // Grace has no tracked seconds and isn't tracking. Alan is on a break but
  // has already worked today, so he is NOT "hasn't started".
  assert.equal(ws.team.notStartedCount, 1);
  assert.equal(ws.team.totalActiveSecondsToday, 5400);
});

test("a Manager gets approvals but not the org-wide pulse", async () => {
  reset();
  const ws = await buildAgentWorkspace(null, MANAGER);
  assert.ok(ws.approvals, "management role gets the approvals count");
  assert.equal(ws.approvals.pendingCount, 3);
  assert.equal(ws.pulse, null, "a Manager is not an org admin");
});

test("a Super Manager gets both approvals and the pulse", async () => {
  reset();
  const ws = await buildAgentWorkspace(null, SUPER_MANAGER);
  assert.ok(ws.approvals);
  assert.ok(ws.pulse);
  assert.equal(ws.pulse.totalActiveSecondsToday, 7200);
  assert.equal(ws.pulse.trackingNowCount, 2);
  assert.equal(ws.pulse.membersWorkedTodayCount, 5);
});

test("an Employee never triggers the approvals or pulse queries at all", async () => {
  reset();
  await buildAgentWorkspace(null, EMPLOYEE);
  const ran = stub.queries.join("\n");
  assert.equal(ran.includes("COUNT(*)::int AS pending"), false, "no approvals query for a non-management role");
  assert.equal(ran.includes("members_worked"), false, "no pulse query for a non-org-admin");
});

test("self carries time off, the latest timesheet (null when there is none) and earnings from the member's own rate", async () => {
  reset();
  const ws = await buildAgentWorkspace(null, EMPLOYEE);
  // policyId travels with the balance so the request dialog can file
  // against a policy without re-fetching the policy list.
  assert.deepEqual(ws.self.timeOff, [
    { policyId: "p1", policyName: "Annual leave", balanceDays: 12.5, entitlementDays: 20 },
  ]);
  assert.equal(ws.self.timesheet, null, "no timesheet rows stubbed");
  assert.equal(ws.self.earnings.hourlyRate, 50);
  // 3600s = 1h at $50 for both the week and month stubs.
  assert.equal(ws.self.earnings.weekAmount, 50);
  assert.equal(ws.self.earnings.monthAmount, 50);
  assert.equal(ws.self.earnings.currency, "USD");
});

// Manual time entry is Manager-and-above only. The agent renders the control
// purely from this flag, so it is the whole gate as far as that surface is
// concerned - a role name spoofed locally must not be able to reveal it.
test("canLogManualTime is true for Manager and every tier above", async () => {
  for (const viewer of [MANAGER, SUPER_MANAGER, { memberId: "m9", roleName: "Admin" }, { memberId: "m8", roleName: "Owner" }]) {
    reset();
    const ws = await buildAgentWorkspace(null, viewer);
    assert.equal(ws.capabilities.canLogManualTime, true, `${viewer.roleName} should be able to log manual time`);
  }
});

test("canLogManualTime is false for every tier below Manager", async () => {
  for (const viewer of [TEAM_LEAD, EMPLOYEE, INTERN, CLIENT]) {
    reset();
    const ws = await buildAgentWorkspace(null, viewer);
    assert.equal(ws.capabilities.canLogManualTime, false, `${viewer.roleName} must not be able to log manual time`);
  }
});

test("a Team Lead who leads a team still cannot log manual time - leading is not managing", async () => {
  reset();
  stub.ledTeamIds = new Set(["team-1"]);
  const ws = await buildAgentWorkspace(null, TEAM_LEAD);
  assert.ok(ws.team, "still gets the team panel");
  assert.equal(ws.capabilities.canLogManualTime, false, "but not manual time entry");
});
