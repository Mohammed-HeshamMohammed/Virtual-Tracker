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
  screenshotProjectIds: null,
  metricProjectIds: [],
  allowedProjectIds: [],
};

const VIEWER = "viewer-1";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";

mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectActivityMetricsPg: async ({ projectIds }) => {
      stub.metricProjectIds.push(projectIds);
      return new Map([...stub.projectMetrics].filter(([id]) => projectIds === null || projectIds.includes(id)));
    },
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
    fetchPgScreenshots: async (memberIds, _day, _limit, options) => {
      stub.screenshotMemberIds = memberIds;
      stub.screenshotProjectIds = options?.projectIds;
      return [];
    },
  },
});

mock.module("../src/http/project-access.js", {
  namedExports: {
    // Employee/Intern are not org project admins; a manager-tier role is.
    isOrgProjectAdminRole: (roleName) =>
      ["owner", "superadmin", "admin", "supermanager"].includes(String(roleName)),
    getViewerProjectIds: async () => stub.allowedProjectIds,
  },
});

mock.module("../src/modules/dashboard/dashboard-base-loader.js", {
  namedExports: {
    pseudoDocsFromSerialized: (rows) => rows.map((row) => ({ id: row.id, data: () => row.data })),
    clearDashboardBaseMemoryCache: () => {},
    loadDashboardBase: async () => ({
      projects: [
        { id: PROJECT, data: { name: "Bana Test", status: "active" } },
        { id: OTHER_PROJECT, data: { name: "Unrelated client project", status: "active" } },
      ],
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
  stub.screenshotProjectIds = null;
  stub.metricProjectIds = [];
  stub.allowedProjectIds = [PROJECT];
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

test("a client gets assigned-project team metrics, with no unrelated project or captures", async () => {
  reset("client");
  stub.projectMetrics.set(OTHER_PROJECT, { activeSeconds: 360000, idleSeconds: 0, memberIds: new Set(["outsider"]) });
  const payload = await getCommandCenterPayload({}, VIEWER);
  assert.equal(payload.isPersonalView, false);
  assert.equal(payload.canSeeAllProjects, false);
  assert.deepEqual(payload.projects.map((p) => p.id), [PROJECT]);
  assert.equal(projectCard(payload).stats.timeWorked, "10h 0m");
  assert.equal(projectCard(payload).personalTaskStats, null);
  assert.ok(stub.metricProjectIds.every((ids) => ids.length === 1 && ids[0] === PROJECT));
  assert.deepEqual(stub.screenshotProjectIds, [PROJECT]);
  assert.ok(stub.dailyCalls.every((call) => call === "project"));
});

test("a client with no assignments receives no projects and an empty metric and capture scope", async () => {
  reset("client");
  stub.allowedProjectIds = [];
  const payload = await getCommandCenterPayload({}, VIEWER);
  assert.deepEqual(payload.projects, []);
  assert.ok(stub.metricProjectIds.every((ids) => Array.isArray(ids) && ids.length === 0));
  assert.deepEqual(stub.screenshotProjectIds, []);
});

test("Team Lead keeps the whole-project view - they manage a team", async () => {
  // Deliberately not in PERSONAL_VIEW_ROLES: the tier boundary is Employee
  // and Intern only, not "everyone below Manager".
  reset("teamlead");
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.timeWorked, "10h 0m");
});

// Activity is the screenshots' activity levels, averaged - the figure every activity page
// shows - and a personal view averages the viewer's own screenshots only.
test("activity percent is the average of the person's own screenshot levels", async () => {
  reset("employee");
  stub.projectMetrics.get(PROJECT).activitySum = 900;
  stub.projectMetrics.get(PROJECT).activityCount = 10;
  stub.personalMetrics = new Map([[PROJECT, { activeSeconds: 1800, idleSeconds: 200, activitySum: 150, activityCount: 3 }]]);
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.activityPercent, 50, "the viewer's 150 over 3 screenshots, not the project's 90%");
});

test("activity with no screenshots is 0 and badged idle, whatever the tracked time", async () => {
  reset("employee");
  stub.personalMetrics = new Map([[PROJECT, { activeSeconds: 1800, idleSeconds: 200, activitySum: 0, activityCount: 0 }]]);
  const card = projectCard(await getCommandCenterPayload({}, VIEWER));
  assert.equal(card.stats.activityPercent, 0);
  assert.equal(card.stats.activityBadge, "IDLE");
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
