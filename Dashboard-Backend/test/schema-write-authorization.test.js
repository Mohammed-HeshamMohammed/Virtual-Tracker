// Guards the write-authorization gates in schema/routes.js.
//
// These gates (management-role, team-role, project-scope, task-access) used to
// live ONLY in that file's generic Firestore fallback. As each entity migrated
// to Postgres it began short-circuiting into the Postgres branch above the
// fallback, which checked none of them - so the gates silently stopped running,
// one entity at a time, purely as a side effect of migrations. An authenticated
// non-management user could POST /api/teams or PATCH /api/employment/:id.
//
// Every case below is written against the *Postgres* path, because that is the
// one that actually serves these entities now.
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const AUTH_CONTEXT = Symbol.for("virtual-tracker.auth-context");

/** @type {{ writes: string[], viewer: any, rows: Record<string, any>, clientManagesProjectId: string | null }} */
const stub = { writes: [], viewer: null, rows: {}, clientManagesProjectId: null };

mock.module("../src/http/auth-context.js", {
  namedExports: {
    getAuthContext: () => stub.viewer,
    requireManagementRole: (ctx) => Boolean(ctx?.isManagement),
    requireAuthContext: () => stub.viewer,
    isManagementRole: (r) => r === "Admin" || r === "Owner",
    AUTH_CONTEXT,
    setAuthContext: async () => null,
  },
});

// Every write funnels through these - recording a call means a gate let it past.
mock.module("../src/modules/schema/services/postgres-crud.service.js", {
  namedExports: {
    POSTGRES_ENTITY_KEYS: new Set(["teams", "employment", "task-comments", "tasks", "projects"]),
    shouldRouteEntityToPostgres: async () => true,
    listPostgresRows: async () => [],
    getPostgresRow: async (key, id) => stub.rows[`${key}:${id}`] ?? null,
    createPostgresRow: async (key, payload) => {
      stub.writes.push(`create:${key}`);
      return { id: "new-row", ...payload };
    },
    updatePostgresRow: async (key, id) => {
      stub.writes.push(`update:${key}:${id}`);
      return { id };
    },
    deletePostgresRow: async (key, id) => {
      stub.writes.push(`delete:${key}:${id}`);
    },
    computeTimesheetHours: async () => null,
    fetchTimeEntriesSinceDate: async () => null,
    sumBillableHoursForProjectInPeriod: async () => null,
  },
});

mock.module("../src/lib/postgres/members-postgres.service.js", {
  namedExports: { getMemberByIdPg: async () => ({ id: "m1" }),
    createMemberPg: async () => null,
    deleteMemberPg: async () => null,
    getMemberAuthContextPg: async () => null,
    getMemberByFirebaseUidPg: async () => null,
    getMembersByIdsPg: async () => [],
    hasMemberPermissionPg: async () => null,
    listMembersEnrichedPg: async () => [],
    listMembersPagePg: async () => [],
    listMembersPg: async () => [],
    resolveMemberIdForFirebaseUidPg: async () => null,
    revokeAllMemberSessionsPg: async () => null,
    updateMemberPg: async () => null,
  },
});
mock.module("../src/http/team-member-assign-policy.js", {
  namedExports: {
    // The gate under test: only management may create teams here.
    canCreateTeams: (roleName) => roleName === "Admin" || roleName === "Owner",
    canAssignMemberToTeam: () => true,
    canBeTeamLead: () => true,
    canBeTeamMember: () => true,
    isClientRole: () => false,
    TEAM_CLIENT_DENIED_MESSAGE: "client",
    TEAM_INELIGIBLE_MEMBER_MESSAGE: "ineligible",
    TEAM_LEAD_ROLE_DENIED_MESSAGE: "lead",
    TEAM_MEMBER_ASSIGN_DENIED_MESSAGE: "assign",
    assertCanBeTeamMemberRole: async () => null,
    hasManageEmployeeTeamsPrivilege: async () => null,
    isEmployeeL2OrHigherRole: async () => null,
  },
});
mock.module("../src/http/team-edit-access.js", {
  namedExports: {
    canEditTeam: async () => false,
    resolveTeamIdFromWrite: () => "t1",
    teamHasMembers: async () => true,
    isProjectOnTeam: async () => false,
    canAssignMemberToTeamRoster: async () => true,
    canManageAllTeams: async () => null,
    getOrgWideEmployeeMemberIds: async () => [],
    getTeamIdsLedByMember: async () => null,
    getTeamStaffableMemberIds: async () => [],
    getTeamStaffableMemberSummaries: async () => [],
    isManagerRole: async () => null,
    isManagerTeamStaffableMember: async () => null,
    isMemberOnTeam: async () => null,
  },
});
mock.module("../src/http/task-access.js", {
  namedExports: {
    // The gate under test for task children: viewer cannot see this task.
    canAccessTask: async () => ({ allowed: false }),
    assertTaskAccessible: async () => null,
    canSyncTaskAssignments: () => true,
    assertCanReviewTasks: async () => null,
  },
});
mock.module("../src/http/project-access.js", {
  namedExports: {
    getViewerProjectIds: async () => null,
    toAllowedProjectSet: () => null,
    viewerCanWriteProject: async () => true,
    viewerCanCreateProjectTasks: async () => true,
    assertAuthenticated: async () => null,
    assertProjectAccessible: async () => null,
    clientMayManageProject: async (_viewer, projectId) =>
      stub.clientManagesProjectId != null && projectId === stub.clientManagesProjectId,
    isOrgProjectAdminRole: async () => null,
    isProjectMemberForTimer: async () => null,
  },
});
mock.module("../src/modules/schema/visibility.js", {
  namedExports: { assertRowVisible: async () => true, applyVisibilityFilter: async (_r, _d, _k, rows) => rows },
});
mock.module("../src/modules/schema/services/schema-crud.service.js", {
  namedExports: {
    buildCreatePayload: (_e, body) => ({ id: "generated", ...body }),
    buildUpdatePayload: (_e, body) => ({ ...body }),
    validateBusinessRules: async () => {},
    validateForeignKeys: async () => {},
    validateRequiredFields: () => {},
    applyTeamWriteMetadata: async () => null,
    normalizeDoc: async () => null,
  },
});
mock.module("../src/modules/schema/catalog/index.js", {
  namedExports: {
    schemaEntities: [],
    schemaByKey: new Map([
      ["teams", { key: "teams", collection: "teams", fields: { id: "uuid", name: "string" } }],
      ["employment", { key: "employment", collection: "employment", fields: { id: "uuid", member_id: "uuid" } }],
      ["task-comments", { key: "task-comments", collection: "tasks", fields: { id: "uuid", task_id: "uuid", body: "text" } }],
      ["projects", { key: "projects", collection: "projects", fields: { id: "uuid", client_can_manage: "boolean", client_can_track: "boolean" } }],
    ]),
    foreignKeyCollectionByField: async () => null,
    generateUUID: async () => null,
    now: async () => null,
  },
});
mock.module("../src/http/read-json-body.js", {
  namedExports: { readJsonBody: async (req) => req.__body ?? {}, MAX_AVATAR_JSON_BODY_BYTES: 1,
    MAX_ACTIVITY_EVENTS_BODY_BYTES: async () => null,
    MAX_JSON_BODY_BYTES: async () => null,
  },
});
mock.module("../src/lib/postgres/tasks-postgres.service.js", {
  namedExports: { getTaskPg: async () => null, getTasksByIdsPg: async () => [], updateTaskPg: async () => null,
    createTaskPg: async () => null,
    deleteTaskPg: async () => null,
    listTasksPg: async () => [],
  },
});
mock.module("../src/lib/firestore/task-subcollections.js", {
  namedExports: {
    isTaskChildEntityKey: (k) => k.startsWith("task-") && k !== "task-assignments",
    deleteTaskWithChildren: async () => {},
  },
});
mock.module("../src/modules/clients/services/client-budget-notify.js", {
  namedExports: { maybeNotifyClientBudgetsForProject: async () => {},
    evaluateAndNotifyClientBudget: async () => null,
    resolveClientBudgetNotifyRecipients: async () => null,
    syncClientBudgetAutomationState: async () => null,
  },
});
mock.module("../src/http/authorization.js", { namedExports: { canAccessMember: async () => true, assertManagementRole: () => true,
    assertMemberAccessible: async () => null,
    assertOrgAdminRole: async () => null,
    canManageMember: async () => null,
  } });
mock.module("../src/modules/activity/activity-scope.js", { namedExports: { resolveMemberRoleName: async () => "Employee",
    buildMemberMetaMap: async () => null,
    getProjectScopedMemberIds: async () => [],
    memberOptionsFromMeta: async () => null,
    resolveActivityFeedScope: async () => null,
  } });

let lastResponse = null;
mock.module("../src/http/response.js", {
  namedExports: {
    sendJson: (_res, _origin, status, payload) => {
      lastResponse = { status, payload };
    },
  },
});

const { routeSchemaCrud } = await import("../src/modules/schema/routes.js");

function makeReqRes(method, pathname, body) {
  // sendJson is mocked above, so `res` is never actually written to - the
  // response is captured in lastResponse instead.
  return { req: { method, __body: body }, res: {}, url: new URL(`http://x${pathname}`) };
}

function reset(viewer) {
  stub.writes = [];
  stub.viewer = viewer;
  stub.rows = {};
  stub.clientManagesProjectId = null;
  lastResponse = null;
}

const EMPLOYEE = { memberId: "m1", roleName: "Employee", isManagement: false };
const ADMIN = { memberId: "m9", roleName: "Admin", isManagement: true };
const CLIENT = { memberId: "c1", roleName: "Client", isManagement: false };

test("an employee cannot create a team through the generic entity route", async () => {
  reset(EMPLOYEE);
  const { req, res, url } = makeReqRes("POST", "/api/teams", { name: "Sneaky Team" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 403, "expected 403, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, [], "no write may reach the database");
});

test("an admin can still create a team", async () => {
  reset(ADMIN);
  // A roster is required on create (validateTeamRoster: at least one member,
  // at least one lead, and the lead has to be one of the members). A
  // name-only body now fails validation before the authorization gate this
  // test is actually about is ever reached.
  const { req, res, url } = makeReqRes("POST", "/api/teams", {
    name: "Real Team",
    members: [{ member_id: "m1", is_lead: true }],
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("create:teams"), true, "admin create must succeed");
});

test("an employee cannot patch an employment record (management-gated entity)", async () => {
  reset(EMPLOYEE);
  stub.rows["employment:e1"] = { id: "e1", member_id: "someone-else" };
  const { req, res, url } = makeReqRes("PATCH", "/api/employment/e1", { member_id: "m1" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 403);
  assert.deepEqual(stub.writes, []);
});

test("an employee cannot delete an employment record either", async () => {
  reset(EMPLOYEE);
  stub.rows["employment:e1"] = { id: "e1", member_id: "someone-else" };
  const { req, res, url } = makeReqRes("DELETE", "/api/employment/e1");
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 403);
  assert.deepEqual(stub.writes, []);
});

test("an admin can patch an employment record", async () => {
  reset(ADMIN);
  stub.rows["employment:e1"] = { id: "e1", member_id: "m1" };
  const { req, res, url } = makeReqRes("PATCH", "/api/employment/e1", { member_id: "m1" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("update:employment:e1"), true);
});

// This one specifically covers the regression introduced when the four task
// child entities were migrated to Postgres earlier in this same session: they
// stopped being checked by assertTaskChildWritable, which had only ever run in
// the Firestore fallback.
test("a comment cannot be created on a task the viewer cannot access", async () => {
  reset(EMPLOYEE);
  const { req, res, url } = makeReqRes("POST", "/api/tasks/t-secret/comments", { body: "leak" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 404, "inaccessible task must read as Not found");
  assert.deepEqual(stub.writes, [], "no comment may be written for an inaccessible task");
});

// A client_can_manage client can edit a project's tasks - that's the whole
// point of the flag - but the flag itself, and its independent
// client_can_track sibling, are not theirs to grant themselves.
test("a client_can_manage client can PATCH their project's ordinary fields", async () => {
  reset(CLIENT);
  stub.clientManagesProjectId = "p1";
  stub.rows["projects:p1"] = { id: "p1" };
  const { req, res, url } = makeReqRes("PATCH", "/api/projects/p1", { name: "Renamed by client" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("update:projects:p1"), true, "an ordinary field edit must succeed");
});

test("a client_can_manage client cannot grant themselves client_can_track via the same PATCH", async () => {
  reset(CLIENT);
  stub.clientManagesProjectId = "p1";
  stub.rows["projects:p1"] = { id: "p1" };
  const { req, res, url } = makeReqRes("PATCH", "/api/projects/p1", { client_can_track: true });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 403, "expected 403, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, [], "no write may reach the database");
});

test("a client_can_manage client cannot grant themselves client_can_manage either (pre-existing gate, still covered)", async () => {
  reset(CLIENT);
  stub.clientManagesProjectId = "p1";
  stub.rows["projects:p1"] = { id: "p1" };
  const { req, res, url } = makeReqRes("PATCH", "/api/projects/p1", { client_can_manage: true });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 403);
  assert.deepEqual(stub.writes, []);
});

test("a client with neither flag on cannot write to the project at all", async () => {
  reset(CLIENT);
  stub.clientManagesProjectId = null;
  stub.rows["projects:p1"] = { id: "p1" };
  const { req, res, url } = makeReqRes("PATCH", "/api/projects/p1", { name: "Sneaky rename" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 403);
  assert.deepEqual(stub.writes, []);
});
