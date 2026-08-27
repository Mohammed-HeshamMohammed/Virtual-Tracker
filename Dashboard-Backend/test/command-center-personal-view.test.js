// The Command Center's cards are whole-project figures for every role that
// manages people - Time Worked, Avg Team Activity and the weekly trend all
// aggregate everyone staffed on the project. Intern and Employee have nobody
// to manage, so for those two roles (and only those two) the same cards read
// as that one person's own work: their hours, their activity, their tasks,
// their captures. Which projects appear is unchanged - already scoped to the
// ones they're related to. Budget stays the project's, because budget is only
// ever tracked per project and there is no per-member split to show.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

/** @type {{ role: string, projectMetrics: Map<string, any>, personalMetrics: Map<string, any>, dailyCalls: string[], screenshotMemberIds: any }} */
const stub = {
  role: "employee",
  projectMetrics: new Map(),
  personalMetrics: new Map(),
  dailyCalls: [],
  screenshotMemberIds: null,
};

const VIEWER = "viewer-1";
const PROJECT = "11111111-1111-4111-8111-111111111111";

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectActivityMetricsPg: async () => stub.projectMetrics,
    getDailyActivityTotalsPg: async () => {
      stub.dailyCalls.push("project");
      return new Map([["2026-08-27", { activeSeconds: 36000, idleSeconds: 0 }]]);
    },
    getMemberDailyActivityTotalsPg: async () => {
      stub.dailyCalls.push("member");
      return new Map([["2026-08-27", { activeSeconds: 1800, idleSeconds: 0 }]]);
    },
    getMemberProjectActivityMetricsPg: async () => stub.personalMetrics,
    getMemberActivitySecondsPg: async () => new Map(),
    getMemberWeeklyCapacityPg: async () => new Map(),
  },
});

mock.module("../src/modules/activity/activity-scope.js", {
  namedExports: {
    resolveMemberRoleName: async () => stub.role,
    getProjectScopedMemberIds: async () => new Set([VIEWER, "coworker-1"]),
    buildMemberMetaMap: async (_db, ids) =>
      new Map((ids ?? []).map((id) => [id, { name: `Name ${id}`, initials: "NN" }])),
    resolveActivityFeedScope: async () => ({ targetMemberIds: [VIEWER, "coworker-1"] }),
    memberOptionsFromMeta: () => [],
  },
});

mock.module("../src/lib/postgres/activity-events-postgres.service.js", {
  namedExports: {
    fetchPgScreenshots: async (memberIds) => {
      stub.screenshotMemberIds = memberIds;
      return [];
    },
  },
});

mock.module("../src/http/project-access.js", {
  namedExports: {
    // Employee/Intern are not org project admins; a manager-tier role is.
    isOrgProjectAdminRole: (roleName) =>
      ["owner", "superadmin", "admin", "supermanager"].includes(String(roleName)),
    getViewerProjectIds: async () => [PROJECT],
  },
});

mock.module("../src/modules/dashboard/dashboard-base-loader.js", {
  namedExports: {
    pseudoDocsFromSerialized: (rows) => rows.map((row) => ({ id: row.id, data: () => row.data })),
    clearDashboardBaseMemoryCache: () => {},
    loadDashboardBase: async () => ({
      projects: [{ id: PROJECT, data: { name: "Bana Test", status: "active" } }],
      budgets: [],
      projectMembers: [
        { id: "pm1", data: { project_id: PROJECT, member_id: VIEWER } },
        { id: "pm2", data: { project_id: PROJECT, member_id: "coworker-1" } },
      ],
      tasks: [
        { id: "t1", data: { project_id: PROJECT, title: "Mine, running", status: "in_progress", assigned_to: VIEWER } },
        { id: "t2", data: { project_id: PROJECT, title: "Mine, done", status: "done", assigned_to: VIEWER } },
        { id: "t3", data: { project_id: PROJECT, title: "Theirs", status: "in_progress", assigned_to: "coworker-1" } },
      ],
    }),
  },
});

const { getCommandCenterPayload } = await import("../src/modules/dashboard/command-center-service.js");

function reset(role) {
  stub.role = role;
  stub.dailyCalls = [];
  stub.screenshotMemberIds = null;
  // The project worked 10h with two people on it; the viewer's own share is 30m.
  stub.projectMetrics = new Map([
    [PROJECT, { activeSeconds: 36000, idleSeconds: 4000, memberIds: new Set([VIEWER, "coworker-1"]) }],
  ]);
  stub.personalMetrics = new Map([[PROJECT, { activeSeconds: 1800, idleSeconds: 200 }]]);
}

/** The single-project card (the "all" card is only added when there are 2+). */
function projectCard(payload) {
  return payload.projects.find((p) => p.id === PROJECT);
}

test("an employee's Total Time Worked is their own hours, not the project's", async () => {
  reset("employee");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.timeWorked, "30m", "30m is the viewer's own 1800s, not the project's 10h");
});

test("an intern gets the same personal scoping as an employee", async () => {
  reset("intern");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.timeWorked, "30m");
});

test("a manager still sees the whole project's hours - the existing view is untouched", async () => {
  reset("manager");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.timeWorked, "10h 0m");
});

test("Team Lead keeps the whole-project view - they manage a team", async () => {
  // Deliberately not in PERSONAL_VIEW_ROLES: the tier boundary is Employee
  // and Intern only, not "everyone below Manager".
  reset("teamlead");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.timeWorked, "10h 0m");
});

test("activity percent is computed from the person's own active/idle split", async () => {
  reset("employee");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  // 1800 active of 2000 tracked = 90%, vs the project's 36000/40000 = 90%
  // only by coincidence of this fixture - assert against the personal totals
  // by changing the split so the two cannot agree.
  stub.personalMetrics = new Map([[PROJECT, { activeSeconds: 1000, idleSeconds: 1000 }]]);
  const recomputed = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.activityPercent, 90);
  assert.equal(recomputed.stats.activityPercent, 50, "50% is the viewer's own split, not the project's 90%");
});

test("the Active Members card is replaced by the person's own task counts", async () => {
  reset("employee");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.deepEqual(
    card.personalTaskStats,
    { inProgress: 1, assigned: 2 },
    "the viewer owns t1 (in progress) and t2 (done) - t3 belongs to a coworker",
  );
});

test("every other role gets personalTaskStats: null, so their card renders unchanged", async () => {
  reset("manager");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.personalTaskStats, null);
  assert.equal(card.stats.activeMembers, "2", "the team headcount that card has always shown");
});

test("the weekly trend is fetched per-member for a personal view and per-project otherwise", async () => {
  reset("employee");
  await getCommandCenterPayload({}, VIEWER);
  assert.ok(
    stub.dailyCalls.every((call) => call === "member"),
    "a personal Time Worked card above a project-wide chart would contradict itself",
  );

  reset("manager");
  await getCommandCenterPayload({}, VIEWER);
  assert.ok(stub.dailyCalls.every((call) => call === "project"));
});

test("the activity feed is the person's own captures on a personal view", async () => {
  reset("employee");
  await getCommandCenterPayload({}, VIEWER);
  assert.deepEqual(stub.screenshotMemberIds, [VIEWER]);

  reset("manager");
  await getCommandCenterPayload({}, VIEWER);
  assert.deepEqual(
    stub.screenshotMemberIds,
    [VIEWER, "coworker-1"],
    "a manager keeps the project-scoped feed of everyone they may already see",
  );
});

test("only the person's own completed tasks reach a personal activity feed", async () => {
  reset("employee");
  const payload = await getCommandCenterPayload({}, VIEWER);
  const taskRows = payload.globalActivityFeed.filter((item) => item.type === "task");
  assert.deepEqual(taskRows.map((row) => row.task), ["Mine, done"]);
});

test("budget stays the project's figure - there is no per-member budget to show", async () => {
  reset("employee");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.budgetLabel, "No Budget");
  assert.equal(card.stats.budgetPercent, 0);
});

test("isPersonalView is reported to the client for Employee/Intern only", async () => {
  reset("employee");
  assert.equal((await getCommandCenterPayload({}, VIEWER)).isPersonalView, true);
  reset("intern");
  assert.equal((await getCommandCenterPayload({}, VIEWER)).isPersonalView, true);
  reset("manager");
  assert.equal((await getCommandCenterPayload({}, VIEWER)).isPersonalView, false);
  reset("admin");
  assert.equal((await getCommandCenterPayload({}, VIEWER)).isPersonalView, false);
});
