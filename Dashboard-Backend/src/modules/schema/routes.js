// Generic schema CRUD routes (/api/v1/:entity) with access gates per entity type.
import { getAuthContext, isManagementRole, requireManagementRole } from "../../http/auth-context.js";
import { canAccessMember } from "../../http/authorization.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { canAccessTask } from "../../http/task-access.js";
import {
  clientMayManageProject,
  clientMayTrackProject,
  getViewerProjectIds,
  isProjectMemberForTimer,
  toAllowedProjectSet,
  viewerCanWriteProject,
  viewerCanCreateProjectTasks,
} from "../../http/project-access.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { sendPgConstraintError } from "../../http/api-error.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { assertRowVisible, applyVisibilityFilter } from "./visibility.js";
import { schemaByKey, schemaEntities } from "./catalog/index.js";
import { buildCreatePayload, buildUpdatePayload, validateBusinessRules, validateForeignKeys, validateRequiredFields } from "./services/schema-crud.service.js";
import { canEditTeam, resolveTeamIdFromWrite, teamHasMembers, isProjectOnTeam, canAssignMemberToTeamRoster } from "../../http/team-edit-access.js";
import {
  canAssignMemberToTeam,
  canBeTeamLead,
  canBeTeamMember,
  canCreateTeams,
  isClientRole,
  TEAM_CLIENT_DENIED_MESSAGE,
  TEAM_INELIGIBLE_MEMBER_MESSAGE,
  TEAM_LEAD_ROLE_DENIED_MESSAGE,
  TEAM_MEMBER_ASSIGN_DENIED_MESSAGE,
} from "../../http/team-member-assign-policy.js";
import { maybeNotifyClientBudgetsForProject } from "../clients/services/client-budget-notify.js";
import { createTeamInitialRoster, parseTeamRosterInput, syncTeamRoster, validateTeamRoster } from "../teams/team-roster.service.js";
import { isTaskChildEntityKey } from "../../lib/firestore/task-subcollections.js";
import { getTaskPg, getTasksByIdsPg, updateTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";
import { parseTaskChildPath, resolveTaskParentIdFromQuery } from "./collection-ref.js";
import { assertManualTimeEntryWithinLimits } from "../tasks/manual-time-entry-limits.js";

// Roster/link arrays the team wizard posts alongside the `teams` row itself.
// They are not `teams` columns, so without allowlisting them here
// rejectUnknownEntityFields 400s the whole create/edit ("Unexpected field:
// member_ids"). They are consumed by team-roster.service.js, which writes
// team_members / team_projects after the team row lands.
const TEAM_ROSTER_INPUT_FIELDS = [
  "member_ids",
  "memberIds",
  "lead_ids",
  "leadIds",
  "project_ids",
  "projectIds",
  "members",
];

/** True when a teams PATCH body carries roster/link work, not just columns. */
function hasTeamRosterInput(body) {
  return TEAM_ROSTER_INPUT_FIELDS.some((field) => Array.isArray(body?.[field]));
}
import {
  shouldRouteEntityToPostgres,
  listPostgresRows,
  getPostgresRow,
  createPostgresRow,
  updatePostgresRow,
  deletePostgresRow,
} from "./services/postgres-crud.service.js";

function parsePath(pathname) {
  const match = /^\/api(?:\/v1)?\/([a-z-]+)(?:\/([^/]+))?$/.exec(pathname);
  return match ? { key: match[1], id: match[2] ?? null } : null;
}

const MANAGEMENT_WRITE_KEYS = new Set([
  "members",
  "invites",
  "roles",
  "projects",
  "clients",
  "pay-rates",
  "limits",
  "employment",
  "task-assignments",
  "teams",
  "team-members",
  "team-projects",
  "project-members",
  "project-budgets",
  "project-member-limits",
  "client-projects",
  "timesheets",
]);

const TIME_ENTRY_WRITE_KEY = "time-entries";

const TEAM_WRITE_KEYS = new Set(["teams", "team-members", "team-projects"]);

/** Management gate applies to MANAGEMENT_WRITE_KEYS except team entities (handled by assertTeamWriteAuthorized). */
function requiresManagementWriteGate(entityKey) {
  return MANAGEMENT_WRITE_KEYS.has(entityKey) && !TEAM_WRITE_KEYS.has(entityKey);
}

const PROJECT_WRITE_KEYS = new Set([
  "projects",
  "project-members",
  "project-budgets",
  "project-member-limits",
  "client-projects",
]);

const TASK_CHILD_WRITE_KEYS = new Set([
  "task-subtasks",
  "task-comments",
  "task-attachments",
  "task-hours",
]);

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} entityKey
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | undefined} existingData
 */
async function assertTaskChildWritable(req, res, origin, db, entityKey, body, existingData) {
  if (!TASK_CHILD_WRITE_KEYS.has(entityKey)) return true;
  const taskId =
    (typeof body.task_id === "string" && body.task_id) ||
    (typeof body.taskId === "string" && body.taskId) ||
    (typeof existingData?.task_id === "string" && existingData.task_id) ||
    "";
  if (!taskId) return true;
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  const result = await canAccessTask(db, viewer.memberId, viewer.roleName, taskId);
  if (!result.allowed) {
    sendJson(res, origin, 404, { success: false, error: "Not found." });
    return false;
  }
  return true;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} entityKey
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | undefined} existingData
 * @param {{ method?: string, resourceId?: string }} [options]
 */
async function assertTeamWriteAuthorized(
  req,
  res,
  origin,
  db,
  entityKey,
  body,
  existingData,
  options = {},
) {
  if (!TEAM_WRITE_KEYS.has(entityKey)) return true;
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }

  const method = options.method ?? req.method ?? "GET";
  const resourceId = options.resourceId;
  const teamId = resolveTeamIdFromWrite(entityKey, body, existingData, resourceId);

  if (method === "POST" && entityKey === "teams") {
    const viewerData = (await getMemberByIdPg(viewer.memberId)) || {};
    if (!canCreateTeams(viewer.roleName, viewerData)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
      return false;
    }
  } else if (method === "POST") {
    const managementTeamProjectLink = entityKey === "team-projects" && requireManagementRole(viewer);
    if (!managementTeamProjectLink) {
      const viewerData = (await getMemberByIdPg(viewer.memberId)) || {};
      const allowed =
        (teamId && (await canEditTeam(db, viewer.memberId, viewer.roleName, teamId))) ||
        (teamId &&
          canCreateTeams(viewer.roleName, viewerData) &&
          !(await teamHasMembers(db, teamId)));
      if (!allowed) {
        sendJson(res, origin, 403, {
          success: false,
          error: "Only the organization Owner or team leads can edit this team.",
        });
        return false;
      }
    }
  } else if (method === "PATCH" || method === "PUT" || method === "DELETE") {
    const managementTeamProjectLink = entityKey === "team-projects" && requireManagementRole(viewer);
    if (
      !managementTeamProjectLink &&
      (!teamId || !(await canEditTeam(db, viewer.memberId, viewer.roleName, teamId)))
    ) {
      sendJson(res, origin, 403, {
        success: false,
        error: "Only the organization Owner or team leads can edit this team.",
      });
      return false;
    }
  } else if (!requireManagementRole(viewer)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
    return false;
  }

  if (entityKey === "team-members") {
    const memberId =
      (typeof body.member_id === "string" && body.member_id) ||
      (typeof existingData?.member_id === "string" && existingData.member_id) ||
      "";
    if (memberId) {
      const targetRoleName = await resolveMemberRoleName(db, memberId);
      if (!canBeTeamMember(targetRoleName)) {
        sendJson(res, origin, 403, {
          success: false,
          error: isClientRole(targetRoleName)
            ? TEAM_CLIENT_DENIED_MESSAGE
            : TEAM_INELIGIBLE_MEMBER_MESSAGE,
        });
        return false;
      }
      if (!canAssignMemberToTeam(viewer.roleName, targetRoleName)) {
        sendJson(res, origin, 403, { success: false, error: TEAM_MEMBER_ASSIGN_DENIED_MESSAGE });
        return false;
      }

      const willBeLead =
        method === "DELETE"
          ? false
          : body.is_lead === true || (body.is_lead === undefined && existingData?.is_lead === true);
      if (willBeLead && !canBeTeamLead(targetRoleName)) {
        sendJson(res, origin, 403, { success: false, error: TEAM_LEAD_ROLE_DENIED_MESSAGE });
        return false;
      }

      let allowed = await canAssignMemberToTeamRoster(
        db,
        viewer.memberId,
        viewer.roleName,
        teamId,
        memberId,
      );
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "Cannot modify team membership outside your access scope." });
        return false;
      }
    }
  }
  if (entityKey === "team-projects") {
    const projectId =
      (typeof body.project_id === "string" && body.project_id) ||
      (typeof existingData?.project_id === "string" && existingData.project_id) ||
      "";
    if (projectId) {
      const allowed = await viewerCanWriteProject(db, viewer, projectId);
      if (!allowed && teamId && (await canEditTeam(db, viewer.memberId, viewer.roleName, teamId))) {
        const onTeam = await isProjectOnTeam(db, teamId, projectId);
        if (onTeam) {
          return true;
        }
      }
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "Cannot link projects outside your access scope." });
        return false;
      }
    }
  }
  return true;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} entityKey
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | undefined} existingData
 * @param {string | undefined} resourceId
 */
async function assertProjectWriteAuthorized(req, res, origin, db, entityKey, body, existingData, resourceId) {
  if (!PROJECT_WRITE_KEYS.has(entityKey)) return true;
  const viewer = getAuthContext(req);
  let projectId = "";
  if (entityKey === "projects") {
    projectId = resourceId || (typeof body.id === "string" ? body.id : "");
  } else {
    projectId =
      (typeof body.project_id === "string" && body.project_id) ||
      (typeof body.projectId === "string" && body.projectId) ||
      (typeof existingData?.project_id === "string" && existingData.project_id) ||
      "";
  }
  // A client is not management, but a project with client_can_manage on is
  // theirs to run. Everyone else still needs a management role.
  const clientManages = projectId ? await clientMayManageProject(viewer, projectId) : false;
  if (!clientManages && !requireManagementRole(viewer)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
    return false;
  }
  // Neither switch is the client's to flip - a client_can_manage client could
  // otherwise send client_can_track: true in the same PATCH that edits a task
  // and grant themselves tracking access nobody on the org side approved.
  if (
    clientManages &&
    entityKey === "projects" &&
    (Object.prototype.hasOwnProperty.call(body, "client_can_manage") ||
      Object.prototype.hasOwnProperty.call(body, "client_can_track"))
  ) {
    sendJson(res, origin, 403, {
      success: false,
      error: "Only the project's organization can change who may manage or track it.",
    });
    return false;
  }
  if (projectId) {
    const allowed = await viewerCanWriteProject(db, viewer, projectId);
    if (!allowed) {
      sendJson(res, origin, 403, { success: false, error: "Cannot modify projects outside your access scope." });
      return false;
    }
  }
  if (entityKey === "project-members") {
    const memberId =
      (typeof body.member_id === "string" && body.member_id) ||
      (typeof body.memberId === "string" && body.memberId) ||
      (typeof existingData?.member_id === "string" && existingData.member_id) ||
      "";
    if (memberId) {
      const allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, memberId);
      if (!allowed) {
        sendJson(res, origin, 403, { success: false, error: "Cannot modify project membership outside your access scope." });
        return false;
      }
    }
  }
  return true;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | undefined} existingData
 */
async function assertTimeEntryWriteAuthorized(req, res, origin, db, body, existingData) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  const memberId =
    (typeof body.member_id === "string" && body.member_id) ||
    (typeof existingData?.member_id === "string" && existingData.member_id) ||
    viewer.memberId;
  if (memberId === viewer.memberId) return true;
  if (!requireManagementRole(viewer)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
    return false;
  }
  const allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, memberId);
  if (!allowed) {
    sendJson(res, origin, 403, { success: false, error: "Cannot modify time entries outside your access scope." });
    return false;
  }
  return true;
}

/**
 * A time entry's member must actually belong to its project - the client
 * already scopes the "Add time for someone" dropdown to the project's own
 * members, but nothing on the server enforced it, so a stale/bypassed
 * client could log time for a member with no real tie to the project.
 * Reuses the exact rule the live task-less timer already applies
 * (isProjectMemberForTimer): org-admin-tier roles and a client with
 * client_can_track need no project_members row, anyone else does.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} projectId
 */
async function assertMemberOnProjectForTimeEntry(db, memberId, projectId) {
  if (!memberId || !projectId) return;
  const targetRoleName = await resolveMemberRoleName(db, memberId);
  const onProject = await isProjectMemberForTimer(db, { memberId, roleName: targetRoleName }, projectId);
  if (!onProject) {
    throw new Error("This member is not assigned to the selected project.");
  }
}

/**
 * Whether this viewer's manual time entries land pre-approved (Manager and
 * above, or a client on a project they're allowed to clock in on) or as a
 * request awaiting review (everyone else - Employee, Intern, Team Lead).
 * Mirrors the workspace endpoint's canLogManualTime split at the org-role
 * boundary, with the client carve-out layered on top for the one project
 * they were actually granted clock-in rights on.
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string} projectId
 */
async function timeEntryAutoApproves(viewer, projectId) {
  if (isManagementRole(viewer.roleName)) return true;
  if (!projectId) return false;
  return clientMayTrackProject(viewer, projectId);
}

/**
 * Manual time is a self-reported claim about work nobody observed - whether
 * it lands approved or pending can only be decided by who is actually
 * making the claim, never by what the request body says. Without this, a
 * client-supplied `status: "approved"` on create (or a PATCH to `status`
 * from the entry's own creator, who assertTimeEntryWriteAuthorized already
 * lets touch their own row) would let anyone self-approve their own
 * request outright.
 *
 * Mutates `payload.status`:
 *  - create (`existingStatus` undefined): always server-decided from who is
 *    creating it - the client's own `status`, if it sent one at all, is
 *    discarded entirely. Nobody chooses to create their own entry pending
 *    when they could just send "approved" instead; this is the fact that
 *    matters, not a preference.
 *  - update, not touching status: left alone completely - editing your own
 *    still-pending entry's hours or description is unaffected either way.
 *  - update, touching status (an approve/reject action): honored only from
 *    someone entitled to approve entries on this project (the same test as
 *    create's auto-approve) - anyone else's attempt to change it is
 *    reverted to whatever it already was, including the entry's own
 *    creator trying to flip their own pending request to approved by hand.
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {Record<string, unknown>} payload
 * @param {string} projectId Resolved by the caller as payload.project_id ??
 *   existing.project_id - an update that doesn't touch the project must
 *   still check against the entry's real, existing one, not an absent field.
 * @param {string} [existingStatus]
 */
async function resolveTimeEntryStatus(viewer, payload, projectId, existingStatus) {
  const isCreate = existingStatus === undefined;
  if (!isCreate && !("status" in payload)) return;

  const canApprove = await timeEntryAutoApproves(viewer, projectId);

  if (isCreate) {
    payload.status = canApprove ? "approved" : "pending";
    return;
  }
  // An approver's update is honored as requested (they may approve or
  // reject, freely) - only a non-approver's attempt is overwritten.
  if (!canApprove) payload.status = existingStatus;
}

/**
 * Every write gate the generic Firestore fallback used to apply, in the same
 * order it applied them.
 *
 * These were only ever wired into that fallback path. As each entity moved to
 * Postgres it started short-circuiting into the Postgres branch above, which
 * checked none of them - so the gates silently stopped running, one entity at
 * a time, as a side effect of migrations rather than any deliberate decision.
 * The result was that an authenticated non-management user could POST
 * /api/teams, PATCH /api/employment/:id, or write task comments on a task they
 * cannot see, because nothing between authentication and the SQL write ever
 * asked. Applied here so the gates follow the entity, not the storage engine.
 *
 * @param {{ method?: string, resourceId?: string }} [options]
 * @returns {Promise<boolean>} false when a response has already been sent.
 */
async function assertGenericWriteAuthorized(
  req,
  res,
  origin,
  db,
  entityKey,
  body,
  existingData,
  options = {},
) {
  if (requiresManagementWriteGate(entityKey) && !requireManagementRole(getAuthContext(req))) {
    // A client managing this project passes here and is then checked against
    // that project specifically by the project/task gates below.
    const viewer = getAuthContext(req);
    const projectId =
      (typeof body?.project_id === "string" && body.project_id) ||
      (typeof body?.projectId === "string" && body.projectId) ||
      (typeof existingData?.project_id === "string" && existingData.project_id) ||
      (entityKey === "projects" ? options.resourceId || "" : "");
    if (!projectId || !(await clientMayManageProject(viewer, projectId))) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
      return false;
    }
  }
  if (!(await assertTaskChildWritable(req, res, origin, db, entityKey, body, existingData))) return false;
  if (!(await assertTeamWriteAuthorized(req, res, origin, db, entityKey, body, existingData, options))) return false;
  if (
    !(await assertProjectWriteAuthorized(req, res, origin, db, entityKey, body, existingData, options.resourceId))
  ) {
    return false;
  }
  return true;
}

/**
 * "Only project managers can create tasks for this project" - same check the
 * Firestore fallback ran on task creation. POST /api/tasks is not handled by
 * routeTasks (it only serves GET), so without this the generic Postgres path
 * was the one creating tasks, with no project-scope check at all.
 * @returns {Promise<boolean>} false when a response has already been sent.
 */
async function assertTaskCreateAuthorized(req, res, origin, db, entityKey, payload, body) {
  if (entityKey !== "tasks") return true;
  const viewer = getAuthContext(req);
  const projectId =
    (typeof payload.project_id === "string" && payload.project_id) ||
    (typeof body?.projectId === "string" && body.projectId) ||
    "";
  if (!viewer || !projectId) return true;
  const allowed = await getViewerProjectIds(db, viewer.memberId, viewer.roleName);
  if (allowed !== null && !allowed.includes(projectId)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this project." });
    return false;
  }
  if (!(await viewerCanCreateProjectTasks(db, viewer, projectId))) {
    sendJson(res, origin, 403, {
      success: false,
      error: "Only project managers can create tasks for this project.",
    });
    return false;
  }
  return true;
}

export async function routeSchemaCrud(req, res, url, db, origin) {
  if ((url.pathname === "/api/schema/entities" || url.pathname === "/api/v1/schema/entities") && req.method === "GET") {
    sendJson(res, origin, 200, { success: true, data: schemaEntities });
    return true;
  }

    if (
    (url.pathname === "/api/tasks/batch/reorder" || url.pathname === "/api/v1/tasks/batch/reorder") &&
    req.method === "PATCH"
  ) {
    const viewer = getAuthContext(req);
    if (!requireManagementRole(viewer)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length) {
        sendJson(res, origin, 400, { success: false, error: "body.updates must be a non-empty array" });
        return true;
      }
      const allowedProjects = viewer
        ? await getViewerProjectIds(db, viewer.memberId, viewer.roleName)
        : [];
      const allowedSet = toAllowedProjectSet(allowedProjects);
      // Two passes: a permission failure used to return 403 *after* earlier
      // rows in the same batch were already written, leaving duplicate or
      // gapped order_index values with no rollback and no signal to the
      // caller. Nothing is written until every row has passed.
      const validated = [];
      for (const row of updates.slice(0, 200)) {
        const id = typeof row?.id === "string" ? row.id : "";
        const orderIndex = row?.order_index ?? row?.orderIndex;
        if (!id || typeof orderIndex !== "number" || !Number.isFinite(orderIndex)) continue;
        const taskData = await getTaskPg(id);
        if (!taskData) continue;
        const projectId = String(taskData.project_id ?? taskData.projectId ?? "").trim();
        if (allowedSet !== null && projectId && !allowedSet.has(projectId)) {
          sendJson(res, origin, 403, {
            success: false,
            error: "Insufficient permissions to reorder tasks in this project.",
          });
          return true;
        }
        validated.push({ id, orderIndex: Math.trunc(orderIndex) });
      }
      const touched = [];
      for (const { id, orderIndex } of validated) {
        await updateTaskPg(id, { order_index: orderIndex });
        touched.push(id);
      }
      if (!touched.length) {
        sendJson(res, origin, 400, { success: false, error: "No valid task updates" });
        return true;
      }
      const data = await getTasksByIdsPg(touched);
      sendJson(res, origin, 200, { success: true, data });
    } catch (error) {
      logSafeError("[tasks/batch/reorder]", error);
      if (sendPgConstraintError(res, origin, error, req)) return true;
      sendJson(res, origin, 400, {
        success: false,
        error: error instanceof Error ? error.message : "Failed to reorder tasks",
      });
    }
    return true;
  }

  const taskChildRoute = parseTaskChildPath(url.pathname);
  let parsed = taskChildRoute
    ? { key: taskChildRoute.entityKey, id: taskChildRoute.childId }
    : parsePath(url.pathname);
  if (!parsed) return false;
  const entity = schemaByKey.get(parsed.key);
  if (!entity) return false;
  let taskParentId = taskChildRoute?.taskId ?? null;
  if (isTaskChildEntityKey(parsed.key) && !taskParentId) {
    taskParentId = resolveTaskParentIdFromQuery(url);
  }
  try {
    if (await shouldRouteEntityToPostgres(parsed.key)) {
      if (req.method === "GET" && !parsed.id) {
        let rows = await listPostgresRows(parsed.key, url);
        rows = await applyVisibilityFilter(req, db, parsed.key, rows);
        sendJson(res, origin, 200, { success: true, data: rows });
        return true;
      }
      if (req.method === "GET" && parsed.id) {
        const row = await getPostgresRow(parsed.key, parsed.id);
        if (!row) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const visible = await assertRowVisible(req, db, parsed.key, row);
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        sendJson(res, origin, 200, { success: true, data: row });
        return true;
      }
      if (req.method === "POST" && !parsed.id) {
        const body = await readJsonBody(req);
        // task_id has to be injected before the gates, not after: the client
        // reaches task children via /api/tasks/:taskId/comments rather than
        // putting task_id in the body, and assertTaskChildWritable resolves
        // the task to check access from exactly that field.
        if (isTaskChildEntityKey(parsed.key) && taskParentId && !body.task_id) {
          body.task_id = taskParentId;
        }
        const writeOk = await assertGenericWriteAuthorized(req, res, origin, db, parsed.key, body, undefined, {
          method: "POST",
        });
        if (!writeOk) return true;
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, body, undefined);
          if (!timeEntryOk) return true;
        }
        const payload = buildCreatePayload(entity, body, {
          extraAllowedFields: parsed.key === "teams" ? TEAM_ROSTER_INPUT_FIELDS : [],
        });
        if (isTaskChildEntityKey(parsed.key) && taskParentId && !payload.task_id) {
          payload.task_id = taskParentId;
        }
        // Validate the roster before inserting the team row, so an invalid
        // roster 400s instead of leaving an empty team behind.
        let teamRoster = null;
        if (parsed.key === "teams") {
          teamRoster = parseTeamRosterInput(body);
          const rosterError = validateTeamRoster(teamRoster.memberIds, [...teamRoster.leadIds]);
          if (rosterError) return sendJson(res, origin, 400, { success: false, error: rosterError }), true;
        }
        const taskCreateOk = await assertTaskCreateAuthorized(req, res, origin, db, parsed.key, payload, body);
        if (!taskCreateOk) return true;
        validateRequiredFields(parsed.key, payload);
        await validateBusinessRules(parsed.key, payload, db, {
          actorRoleName: getAuthContext(req)?.roleName ?? "",
        });
        await validateForeignKeys(db, payload, { entityKey: parsed.key });
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          // A manual entry is real worked time typed in by hand, not exempt
          // from the same daily/weekly and per-project-member caps a live
          // timer is already stopped at (timer-limit.service.js) - it just
          // used to be created with zero awareness of either.
          await assertMemberOnProjectForTimeEntry(db, payload.member_id, payload.project_id);
          await assertManualTimeEntryWithinLimits(db, {
            memberId: payload.member_id,
            projectId: payload.project_id,
            date: payload.date,
            durationSeconds: Number(payload.duration) || 0,
          });
          // Last write to `payload` before the INSERT, deliberately - see
          // resolveTimeEntryStatus's own doc comment for why this can never
          // be decided from the request body.
          await resolveTimeEntryStatus(getAuthContext(req), payload, String(payload.project_id ?? ""));
        }
        const created = await createPostgresRow(parsed.key, payload);
        if (teamRoster && created?.id) {
          // Roster writes enforce their own per-member/per-project permission
          // checks and can throw - drop the just-created team rather than
          // leaving a memberless orphan the wizard can't reach again.
          try {
            await createTeamInitialRoster(db, getAuthContext(req), String(created.id), teamRoster);
          } catch (rosterErr) {
            await deletePostgresRow(parsed.key, String(created.id)).catch(() => {});
            throw rosterErr;
          }
        }
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const projectId = typeof payload.project_id === "string" ? payload.project_id : "";
          if (projectId) await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
        sendJson(res, origin, 201, { success: true, data: created });
        return true;
      }
      if ((req.method === "PUT" || req.method === "PATCH") && parsed.id) {
        const existing = await getPostgresRow(parsed.key, parsed.id);
        if (!existing) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const body = await readJsonBody(req);
        const writeOk = await assertGenericWriteAuthorized(req, res, origin, db, parsed.key, body, existing, {
          method: req.method,
          resourceId: parsed.id,
        });
        if (!writeOk) return true;
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, body, existing);
          if (!timeEntryOk) return true;
        }
        const visible = await assertRowVisible(req, db, parsed.key, existing);
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        // §6.9 optimistic-concurrency token - client-only, never a real
        // column, so it must be allowlisted here or every entity's PATCH
        // 400s as an "Unexpected field" before the conditional-write check
        // (expectedUpdatedAt, read right below) ever runs.
        const payload = buildUpdatePayload(entity, body, {
          extraAllowedFields: [
            "expected_updated_at",
            "expectedUpdatedAt",
            ...(parsed.key === "teams" ? TEAM_ROSTER_INPUT_FIELDS : []),
          ],
        });
        // A roster-only edit (membership/leads/projects changed, team name
        // untouched) yields an empty column payload - that is a valid edit
        // here, so only reject when there is no roster work either.
        const teamRosterPatch =
          parsed.key === "teams" && hasTeamRosterInput(body) ? parseTeamRosterInput(body) : null;
        if (teamRosterPatch) {
          const rosterError = validateTeamRoster(teamRosterPatch.memberIds, [...teamRosterPatch.leadIds]);
          if (rosterError) return sendJson(res, origin, 400, { success: false, error: rosterError }), true;
        }
        if (Object.keys(payload).length === 0 && !teamRosterPatch) {
          return sendJson(res, origin, 400, { success: false, error: "No valid fields to update" }), true;
        }
        await validateBusinessRules(parsed.key, { ...payload, id: parsed.id }, db, {
          actorRoleName: getAuthContext(req)?.roleName ?? "",
        });
        if (parsed.key === TIME_ENTRY_WRITE_KEY && payload.project_id !== undefined) {
          // Re-pointing an entry at a different project - the member has to
          // actually belong to that one too, same rule create-time enforces.
          await assertMemberOnProjectForTimeEntry(db, existing.member_id, payload.project_id);
        }
        if (parsed.key === TIME_ENTRY_WRITE_KEY && (payload.duration !== undefined || payload.date !== undefined || payload.project_id !== undefined)) {
          // Re-check against the merged row (existing + this edit's
          // overrides), excluding this entry's own current duration from
          // what's already "spent" - otherwise every edit would count the
          // row against itself and false-positive on its own unchanged time.
          await assertManualTimeEntryWithinLimits(db, {
            memberId: existing.member_id,
            projectId: payload.project_id ?? existing.project_id,
            date: payload.date ?? existing.date,
            durationSeconds: Number(payload.duration ?? existing.duration) || 0,
            excludeEntryId: String(parsed.id),
          });
        }
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          // Last write to `payload` before the UPDATE - see
          // resolveTimeEntryStatus's own doc comment. A status-only PATCH
          // (the approve/reject action) still needs the entry's real
          // project, which a status-only body never carries itself.
          await resolveTimeEntryStatus(
            getAuthContext(req),
            payload,
            String(payload.project_id ?? existing.project_id ?? ""),
            String(existing.status ?? "pending"),
          );
        }
        // §6.9 - optional; only forwarded to the "tasks" branch of
        // updatePostgresRow today (see that function's comment for scope).
        const expectedUpdatedAt = body.expected_updated_at ?? body.expectedUpdatedAt ?? undefined;
        if (teamRosterPatch) {
          await syncTeamRoster(db, getAuthContext(req), String(parsed.id), teamRosterPatch);
        }
        const updated =
          Object.keys(payload).length === 0
            ? await getPostgresRow(parsed.key, parsed.id)
            : await updatePostgresRow(parsed.key, parsed.id, payload, existing, expectedUpdatedAt);
        if (updated && typeof updated === "object" && "conflict" in updated) {
          sendJson(res, origin, 409, {
            success: false,
            code: "stale_write",
            error: "Someone else changed this while you were editing. Reload to see their changes.",
            data: updated.current,
          });
          return true;
        }
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const projectId = String(payload.project_id ?? existing.project_id ?? "").trim();
          if (projectId) await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
        sendJson(res, origin, 200, { success: true, data: updated });
        return true;
      }
      if (req.method === "DELETE" && parsed.id) {
        // "tasks" is deliberately not in MANAGEMENT_WRITE_KEYS (project
        // managers may create them), so deletion needs its own gate.
        if (parsed.key === "tasks" && !requireManagementRole(getAuthContext(req))) {
          return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
        }
        const existing = await getPostgresRow(parsed.key, parsed.id);
        if (!existing) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const writeOk = await assertGenericWriteAuthorized(req, res, origin, db, parsed.key, {}, existing, {
          method: "DELETE",
          resourceId: parsed.id,
        });
        if (!writeOk) return true;
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, {}, existing);
          if (!timeEntryOk) return true;
        }
        const visible = await assertRowVisible(req, db, parsed.key, existing);
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        // No child cleanup here on purpose: task_assignments, comments,
        // subtasks, attachments and hours are all Postgres tables with
        // task_id ON DELETE CASCADE, so deleting the tasks row below takes
        // them with it. The Firestore tasks-doc delete that used to run first
        // is gone with the last of that mirror - nothing has written a task
        // doc there since the domain moved.
        await deletePostgresRow(parsed.key, parsed.id);
        sendJson(res, origin, 200, { success: true, data: { id: parsed.id, deleted: true } });
        return true;
      }
    }

    // The task-child guard stays: reaching here with no resolvable parent
    // task means the client used the flat /api/task-comments form without a
    // task_id, which the Postgres branch above cannot answer either.
    if (isTaskChildEntityKey(parsed.key) && !taskParentId) {
      sendJson(res, origin, 400, {
        success: false,
        error: "task_id query parameter or /api/tasks/:taskId/... nested route is required",
      });
      return true;
    }

    // Everything below this point used to be a generic Firestore CRUD
    // implementation - list/get/create/update/delete against
    // db.collection(entity.collection) - serving whichever entities had not
    // been migrated yet. All 32 catalog entities now resolve before it: 29
    // route to Postgres above, invite-projects is managed entirely through
    // relation-sync.js with no caller for the flat path, and
    // member-relationships and member-transfer-requests are each fully
    // handled by their own dedicated routers mounted earlier in
    // handle-request.js. Nothing could reach it, so it is gone rather than
    // left as an unreachable second implementation of every write path -
    // which is exactly how the authorization gates above came to be skipped
    // in the first place: they lived only here, and each migration quietly
    // routed around them.
    sendJson(res, origin, 405, { success: false, error: "Method not allowed" });
    return true;
  } catch (error) {
    // This catch-all previously swallowed everything silently - a genuine
    // server-side failure (DB error, bad constraint, etc.) looked identical
    // to a client mistake, both here and in the server's own logs (there
    // were none). Logged now so a real failure is diagnosable instead of
    // only ever showing up as an opaque 400 in the browser.
    logSafeError(`[schema-crud ${req.method} ${url.pathname}]`, error);
    if (sendPgConstraintError(res, origin, error, req)) return true;
    sendJson(res, origin, 400, { success: false, error: error.message || "Invalid request" });
    return true;
  }
}
