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

/** @type {{ writes: string[], viewer: any, rows: Record<string, any>, clientManagesProjectId: string | null, clientTracksProjectId: string | null, memberOnProject: boolean, project: any, task: any, taskAssigned: boolean }} */
const stub = {
  writes: [],
  viewer: null,
  rows: {},
  clientManagesProjectId: null,
  clientTracksProjectId: null,
  memberOnProject: true,
  // A task-less project type by default, so the cases that predate the
  // task rule (which only ever set a project) stay unaffected by it.
  project: { id: "p1", type: "calling", require_task_to_track: true },
  task: null,
  taskAssigned: true,
};

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
    POSTGRES_ENTITY_KEYS: new Set(["teams", "employment", "task-comments", "tasks", "projects", "time-entries"]),
    shouldRouteEntityToPostgres: async () => true,
    listPostgresRows: async () => [],
    getPostgresRow: async (key, id) => stub.rows[`${key}:${id}`] ?? null,
    createPostgresRow: async (key, payload) => {
      stub.writes.push(`create:${key}`);
      return { id: "new-row", ...payload };
    },
    updatePostgresRow: async (key, id, payload) => {
      stub.writes.push(`update:${key}:${id}`);
      return { id, ...payload };
    },
    deletePostgresRow: async (key, id) => {
      stub.writes.push(`delete:${key}:${id}`);
    },
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
    clientMayTrackProject: async (_viewer, projectId) =>
      stub.clientTracksProjectId != null && projectId === stub.clientTracksProjectId,
    isOrgProjectAdminRole: async () => null,
    // Defaults to "yes, on the project" so the approval-status gates most of
    // this file exercises aren't shadowed by an unrelated 400; the
    // membership-gate tests near the bottom flip stub.memberOnProject to
    // exercise the negative case on purpose.
    isProjectMemberForTimer: async () => stub.memberOnProject,
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
      ["time-entries", { key: "time-entries", collection: "time_entries", fields: { id: "uuid", member_id: "uuid", project_id: "uuid", status: "string" } }],
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
  namedExports: { getTaskPg: async () => stub.task, getTasksByIdsPg: async () => [], updateTaskPg: async () => null,
    createTaskPg: async () => null,
    deleteTaskPg: async () => null,
    listTasksPg: async () => [],
  },
});
// Reached by assertTimeEntryCountable, which mirrors the live timer's
// task rule onto hand-entered time (project type / require_task_to_track /
// who the to-do is assigned to).
mock.module("../src/lib/postgres/projects-postgres.service.js", {
  namedExports: {
    getProjectPg: async () => stub.project,
    listViewerProjectIdsPg: async () => [],
    listProjectMembersPg: async () => [],
    listClientManagedProjectIdsPg: async () => new Set(),
    listClientTrackableProjectIdsPg: async () => new Set(),
    listProjectsPg: async () => [],
    addProjectMemberPg: async () => null,
    archiveProjectPg: async () => null,
    computeProjectBudgetTargetForAllPg: async () => null,
    computeProjectBudgetTargetPg: async () => null,
    computeProjectSpentCostPg: async () => null,
    computeProjectSpentForAllPg: async () => null,
    computeProjectSpentPg: async () => null,
    countMembersByProjectPg: async () => null,
    createProjectPg: async () => null,
    deleteProjectMemberLimitPg: async () => null,
    deleteProjectPg: async () => null,
    deleteTeamProjectsForTeamPg: async () => null,
    getAllProjectBudgetsPg: async () => null,
    getAllProjectMemberLimitsPg: async () => null,
    getDailyActivityTotalsPg: async () => null,
    getMemberActivitySecondsPg: async () => null,
    getMemberDailyActivityTotalsPg: async () => null,
    getMemberProjectActivityMetricsPg: async () => null,
    getMemberWeeklyCapacityPg: async () => null,
    getProjectActivityMetricsPg: async () => null,
    getProjectBudgetPg: async () => null,
    getProjectMemberLimitPg: async () => null,
    getProjectTrackedSecondsPg: async () => null,
    linkClientProjectPg: async () => null,
    linkTeamProjectPg: async () => null,
    listClientIdsForProjectPg: async () => null,
    listMemberIdsForProjectsPg: async () => null,
    listProjectIdsForClientPg: async () => null,
    listProjectIdsForMemberPg: async () => null,
    listProjectIdsForTeamPg: async () => null,
    listProjectMemberLimitsPg: async () => null,
    listTeamIdsForProjectPg: async () => null,
    removeProjectMemberPg: async () => null,
    resolveMemberHourlyRatePg: async () => null,
    toDayStrOrNull: async () => null,
    unlinkClientProjectPg: async () => null,
    unlinkTeamProjectPg: async () => null,
    updateProjectPg: async () => null,
    upsertProjectBudgetPg: async () => null,
    upsertProjectMemberLimitPg: async () => null,
  },
});
mock.module("../src/lib/postgres/task-assignments-postgres.service.js", {
  namedExports: {
    hasAssignmentPg: async () => stub.taskAssigned,
    findAssignmentPg: async () => null,
    getTaskAssignmentsPg: async () => [],
    getTaskIdsAssignedToMembersPg: async () => new Set(),
    getAssignmentsForTasksPg: async () => [],
    getInReviewAssignmentsForTaskPg: async () => [],
    upsertAssignmentPg: async () => null,
    updateAssignmentPg: async () => null,
    deleteAssignmentPg: async () => null,
    getAssignmentByIdPg: async () => null,
    listAllAssignmentsPg: async () => [],
    sumActiveAssignmentSecondsPg: async () => 0,
  },
});
mock.module("../src/lib/firestore/task-subcollections.js", {
  namedExports: {
    isTaskChildEntityKey: (k) => k.startsWith("task-") && k !== "task-assignments",
    deleteTaskWithChildren: async () => {},
  },
});
mock.module("../src/modules/tasks/manual-time-entry-limits.js", {
  namedExports: { assertManualTimeEntryWithinLimits: async () => null },
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
  stub.clientTracksProjectId = null;
  stub.memberOnProject = true;
  stub.project = { id: "p1", type: "calling", require_task_to_track: true };
  stub.task = null;
  stub.taskAssigned = true;
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

// Manual time entry status: who is making the claim decides whether it
// lands approved or pending, never the request body - see
// resolveTimeEntryStatus's own doc comment in schema/routes.js.

test("an employee's own manual time entry lands pending, even if they explicitly asked for approved", async () => {
  reset(EMPLOYEE);
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
    status: "approved",
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 201, "the entry is still created");
  assert.equal(lastResponse.payload.data.status, "pending", "their own requested status is discarded");
});

test("a management-role's manual time entry lands approved automatically", async () => {
  reset(ADMIN);
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.status, "approved");
});

test("a client entitled to track the entry's project gets an approved entry too", async () => {
  reset(CLIENT);
  stub.clientTracksProjectId = "p1";
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "c1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.status, "approved");
});

test("a client NOT entitled to track this particular project still lands pending", async () => {
  reset(CLIENT);
  stub.clientTracksProjectId = "p2"; // a different project
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "c1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.status, "pending");
});

test("an employee cannot flip their own still-pending entry to approved by hand", async () => {
  reset(EMPLOYEE);
  stub.rows["time-entries:e1"] = { id: "e1", member_id: "m1", project_id: "p1", status: "pending" };
  const { req, res, url } = makeReqRes("PATCH", "/api/time-entries/e1", { status: "approved" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.status, "pending", "reverted to what it already was");
});

test("an employee editing their own pending entry's hours (not touching status) is unaffected", async () => {
  reset(EMPLOYEE);
  stub.rows["time-entries:e1"] = { id: "e1", member_id: "m1", project_id: "p1", status: "pending" };
  const { req, res, url } = makeReqRes("PATCH", "/api/time-entries/e1", { duration: 7200 });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.duration, 7200, "the real edit still goes through");
  assert.equal(lastResponse.payload.data.status, undefined, "status was never part of this payload at all");
});

// A manual entry's member must actually belong to its project - the client
// dropdown already scopes to this, but a stale/bypassed client could still
// send an off-project pairing without this server-side gate.

test("creating a manual entry for a member not on the project is rejected", async () => {
  reset(ADMIN);
  stub.memberOnProject = false;
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 400, "expected 400, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, [], "no write may reach the database");
});

test("creating a manual entry for a member who IS on the project succeeds", async () => {
  reset(ADMIN);
  stub.memberOnProject = true;
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("create:time-entries"), true, "expected the write to go through");
});

test("re-pointing an existing entry at a project the member isn't on is rejected", async () => {
  reset(ADMIN);
  stub.rows["time-entries:e1"] = { id: "e1", member_id: "m1", project_id: "p1", status: "approved" };
  stub.memberOnProject = false;
  const { req, res, url } = makeReqRes("PATCH", "/api/time-entries/e1", { project_id: "p2" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 400, "expected 400, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, []);
});

test("a management role can approve someone else's pending entry", async () => {
  reset(ADMIN);
  stub.rows["time-entries:e1"] = { id: "e1", member_id: "m1", project_id: "p1", status: "pending" };
  const { req, res, url } = makeReqRes("PATCH", "/api/time-entries/e1", { status: "approved" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.status, "approved");
});

test("a management role can also reject a pending entry - not forced to approved", async () => {
  reset(ADMIN);
  stub.rows["time-entries:e1"] = { id: "e1", member_id: "m1", project_id: "p1", status: "pending" };
  const { req, res, url } = makeReqRes("PATCH", "/api/time-entries/e1", { status: "rejected" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.payload.data.status, "rejected");
});

// Hand-entered time has to clear the same bar the live timer sets before it
// will start a session (allowsTaskLessTimer + who the to-do belongs to).
// Manual entry used to skip all of it, so it could create exactly what the
// timer refuses. Enforced only once the entry counts - see
// assertTimeEntryCountable on why a pending request is deliberately let
// through.

test("a task-tracking project rejects an approved entry with no to-do named", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "normal", require_task_to_track: true };
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 400, "expected 400, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, [], "no write may reach the database");
});

test("the same project with require_task_to_track off takes it - the per-project opt-out still wins", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "normal", require_task_to_track: false };
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("create:time-entries"), true, "expected the write to go through");
});

test("a type that has no tasks at all never asks for one", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "support", require_task_to_track: true };
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("create:time-entries"), true, "expected the write to go through");
});

test("a to-do from a different project is rejected", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "normal", require_task_to_track: true };
  stub.task = { id: "t1", project_id: "p2", assigned_to: "m1" };
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    task_id: "t1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 400, "expected 400, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, []);
});

test("a to-do on the right project but assigned to someone else is rejected", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "normal", require_task_to_track: true };
  stub.task = { id: "t1", project_id: "p1", assigned_to: "someone-else" };
  stub.taskAssigned = false;
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    task_id: "t1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 400, "expected 400, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, []);
});

test("a to-do assigned through task_assignments (not the legacy column) is accepted", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "normal", require_task_to_track: true };
  stub.task = { id: "t1", project_id: "p1", assigned_to: null };
  stub.taskAssigned = true;
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    task_id: "t1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("create:time-entries"), true, "expected the write to go through");
});

test("an employee's own request against a task-tracking project is still recorded - it lands pending, and pending isn't held to the rule", async () => {
  reset(EMPLOYEE);
  stub.project = { id: "p1", type: "normal", require_task_to_track: true };
  stub.memberOnProject = false;
  const { req, res, url } = makeReqRes("POST", "/api/time-entries", {
    member_id: "m1",
    project_id: "p1",
    date: "2026-09-02",
    duration: 3600,
  });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(stub.writes.includes("create:time-entries"), true, "the request itself must still be recordable");
  assert.equal(lastResponse.payload.data.status, "pending");
});

test("approving that request is where the rule bites - the reviewer has to fix the project or to-do first", async () => {
  reset(ADMIN);
  stub.project = { id: "p1", type: "normal", require_task_to_track: true };
  stub.rows["time-entries:e1"] = { id: "e1", member_id: "m1", project_id: "p1", status: "pending" };
  const { req, res, url } = makeReqRes("PATCH", "/api/time-entries/e1", { status: "approved" });
  await routeSchemaCrud(req, res, url, {}, undefined);
  assert.equal(lastResponse.status, 400, "expected 400, got " + JSON.stringify(lastResponse));
  assert.deepEqual(stub.writes, [], "nothing counts until it genuinely passes");
});
