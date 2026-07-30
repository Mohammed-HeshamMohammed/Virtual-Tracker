// Generic schema CRUD routes (/api/v1/:entity) with access gates per entity type.
import { getAuthContext, requireManagementRole } from "../../http/auth-context.js";
import { canAccessMember } from "../../http/authorization.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { canAccessTask } from "../../http/task-access.js";
import { getViewerProjectIds, toAllowedProjectSet, viewerCanWriteProject, viewerCanCreateProjectTasks } from "../../http/project-access.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { assertRowVisible, applyVisibilityFilter } from "./visibility.js";
import { schemaByKey, schemaEntities } from "./catalog/index.js";
import { buildCreatePayload, buildUpdatePayload, normalizeDoc, validateBusinessRules, validateForeignKeys, validateRequiredFields, applyTeamWriteMetadata } from "./services/schema-crud.service.js";
import {
  deleteInviteProjects,
  deletePendingAuthProjects,
  enrichInvitesWithProjectCounts,
  enrichTeamMembersWithProfiles,
  enrichTeamProjectsWithNames,
  alignMemberRoleTables,
  resolveRoleIdByName,
  resolveRoleNameById,
} from "../members/services/relation-sync.js";
import {
  isInviteExpired,
  shouldHideInviteFromActiveList,
} from "../members/services/invite-lifecycle.js";
import { canEditTeam, isMemberOnTeam, resolveTeamIdFromWrite, teamHasMembers, isProjectOnTeam, canAssignMemberToTeamRoster } from "../../http/team-edit-access.js";
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
import { createTeamInitialRoster, parseTeamRosterInput, syncTeamRoster, validateTeamRoster } from "../teams/team-roster.service.js";
import { maybeNotifyClientBudgetsForProject } from "../clients/services/client-budget-notify.js";
import { syncProjectBudgetFromClients } from "../projects/services/project-budget-from-clients.js";
import { deleteTaskWithChildren, isTaskChildEntityKey } from "../../lib/firestore/task-subcollections.js";
import { getTaskPg, getTasksByIdsPg, updateTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import {
  parseTaskChildPath,
  resolveEntityCollectionRef,
  resolveEntityDocRef,
  resolveTaskParentIdFromQuery,
} from "./collection-ref.js";
import {
  POSTGRES_ENTITY_KEYS,
  shouldRouteEntityToPostgres,
  listPostgresRows,
  getPostgresRow,
  createPostgresRow,
  updatePostgresRow,
  deletePostgresRow,
} from "./services/postgres-crud.service.js";
import { isPostgresConfigured } from "../../lib/postgres/client.js";

function parsePath(pathname) {
  const match = /^\/api(?:\/v1)?\/([a-z-]+)(?:\/([^/]+))?$/.exec(pathname);
  return match ? { key: match[1], id: match[2] ?? null } : null;
}

function resolveTaskAssigneeId(payload, existingData) {
  const fromPayload = String(payload?.assigned_to ?? payload?.assignedTo ?? payload?.assignee_id ?? "").trim();
  if (fromPayload) return fromPayload;
  return String(existingData?.assigned_to ?? existingData?.assignedTo ?? existingData?.assignee_id ?? "").trim() || null;
}

async function notifyTaskAssignee(db, recipientId, taskId, title) {
  if (!recipientId) return;
  const { createNotification } = await import("../notifications/service.js");
  await createNotification(db, {
    recipient_id: recipientId,
    type: "task_assigned",
    title: "New Task Assigned",
    message: `You have been assigned to task: ${title || "Unknown"}`,
    link: `/tasks/${taskId}`,
  });
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
    const viewerSnap = await db.collection("members").doc(viewer.memberId).get();
    const viewerData = viewerSnap.exists ? viewerSnap.data() || {} : {};
    if (!canCreateTeams(viewer.roleName, viewerData)) {
      sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
      return false;
    }
  } else if (method === "POST") {
    const managementTeamProjectLink = entityKey === "team-projects" && requireManagementRole(viewer);
    if (!managementTeamProjectLink) {
      const viewerSnap = await db.collection("members").doc(viewer.memberId).get();
      const viewerData = viewerSnap.exists ? viewerSnap.data() || {} : {};
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
  if (!requireManagementRole(viewer)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." });
    return false;
  }
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

const snakeToCamel = (input) => input.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function fieldValue(row, field) {
  if (Object.prototype.hasOwnProperty.call(row, field)) return row[field];
  const camel = snakeToCamel(field);
  if (Object.prototype.hasOwnProperty.call(row, camel)) return row[camel];
  return undefined;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

/** Avoid Firestore composite indexes when filters are combined with orderBy. */
function sortRowsByField(rows, field, direction = "desc") {
  const mul = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = fieldValue(a, field);
    const bv = fieldValue(b, field);
    const am = timestampMs(av);
    const bm = timestampMs(bv);
    if (am !== bm) return (am - bm) * mul;
    const as = String(av ?? "");
    const bs = String(bv ?? "");
    if (as !== bs) return as.localeCompare(bs) * mul;
    return String(a.id ?? "").localeCompare(String(b.id ?? "")) * mul;
  });
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
      const touched = [];
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
        await updateTaskPg(id, { order_index: Math.trunc(orderIndex) });
        touched.push(id);
      }
      if (!touched.length) {
        sendJson(res, origin, 400, { success: false, error: "No valid task updates" });
        return true;
      }
      const data = await getTasksByIdsPg(touched);
      sendJson(res, origin, 200, { success: true, data });
    } catch (error) {
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
        if (parsed.key === "timesheets" && !requireManagementRole(getAuthContext(req))) {
          return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
        }
        const body = await readJsonBody(req);
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, body, undefined);
          if (!timeEntryOk) return true;
        }
        const payload = buildCreatePayload(entity, body);
        validateRequiredFields(parsed.key, payload);
        await validateBusinessRules(parsed.key, payload, db, {
          actorRoleName: getAuthContext(req)?.roleName ?? "",
        });
        await validateForeignKeys(db, payload, { entityKey: parsed.key });
        const created = await createPostgresRow(parsed.key, payload);
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const projectId = typeof payload.project_id === "string" ? payload.project_id : "";
          if (projectId) await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
        sendJson(res, origin, 201, { success: true, data: created });
        return true;
      }
      if ((req.method === "PUT" || req.method === "PATCH") && parsed.id) {
        if (parsed.key === "timesheets" && !requireManagementRole(getAuthContext(req))) {
          return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
        }
        const existing = await getPostgresRow(parsed.key, parsed.id);
        if (!existing) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const body = await readJsonBody(req);
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, body, existing);
          if (!timeEntryOk) return true;
        }
        const visible = await assertRowVisible(req, db, parsed.key, existing);
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const payload = buildUpdatePayload(entity, body);
        if (Object.keys(payload).length === 0) {
          return sendJson(res, origin, 400, { success: false, error: "No valid fields to update" }), true;
        }
        await validateBusinessRules(parsed.key, { ...payload, id: parsed.id }, db, {
          actorRoleName: getAuthContext(req)?.roleName ?? "",
        });
        const updated = await updatePostgresRow(parsed.key, parsed.id, payload, existing);
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const projectId = String(payload.project_id ?? existing.project_id ?? "").trim();
          if (projectId) await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
        sendJson(res, origin, 200, { success: true, data: updated });
        return true;
      }
      if (req.method === "DELETE" && parsed.id) {
        if (parsed.key === "timesheets" && !requireManagementRole(getAuthContext(req))) {
          return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
        }
        if (parsed.key === "tasks" && !requireManagementRole(getAuthContext(req))) {
          return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
        }
        const existing = await getPostgresRow(parsed.key, parsed.id);
        if (!existing) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        if (parsed.key === TIME_ENTRY_WRITE_KEY) {
          const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, {}, existing);
          if (!timeEntryOk) return true;
        }
        const visible = await assertRowVisible(req, db, parsed.key, existing);
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        if (parsed.key === "tasks") {
          // task_assignments/comments/subtasks/attachments/hours are still Firestore-
          // resident (not migrated yet - see implementation.md Phase 2), so a task
          // delete has to clean those up too, not just the new Postgres tasks row,
          // or they're orphaned with a task_id that no longer resolves anywhere.
          await deleteTaskWithChildren(db, parsed.id);
        }
        await deletePostgresRow(parsed.key, parsed.id);
        sendJson(res, origin, 200, { success: true, data: { id: parsed.id, deleted: true } });
        return true;
      }
    }

    if (isTaskChildEntityKey(parsed.key) && !taskParentId) {
      sendJson(res, origin, 400, {
        success: false,
        error: "task_id query parameter or /api/tasks/:taskId/... nested route is required",
      });
      return true;
    }

    if (req.method === "GET" && !parsed.id) {
      let query = resolveEntityCollectionRef(db, entity, taskParentId);
      let hasFilters = false;
      for (const field of Object.keys(entity.fields)) {
        const queryValue = url.searchParams.get(field) ?? url.searchParams.get(snakeToCamel(field));
        if (queryValue !== null) {
          query = query.where(field, "==", queryValue);
          hasFilters = true;
        }
      }

      const fieldsParam = url.searchParams.get("fields");
      if (fieldsParam) {
        const fieldsToSelect = fieldsParam
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
          .filter((field) => Object.prototype.hasOwnProperty.call(entity.fields, field));
        if (fieldsToSelect.length > 0) {
          // In Firestore, if you use select() and also orderBy(), you must include the orderBy field in the select fields
          const orderByField = entity.defaultOrderBy ?? (entity.fields.created_at ? "created_at" : "id");
          if (!fieldsToSelect.includes(orderByField)) {
            fieldsToSelect.push(orderByField);
          }
          query = query.select(...fieldsToSelect);
        }
      }

      const orderBy = entity.defaultOrderBy ?? (entity.fields.created_at ? "created_at" : "id");
      const fetchLimit = hasFilters ? 500 : 200;
      let snapshot;
      if (hasFilters) {
        snapshot = await query.limit(fetchLimit).get();
      } else {
        try {
          snapshot = await query.orderBy(orderBy, "desc").limit(fetchLimit).get();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("index")) throw error;
          snapshot = await query.limit(fetchLimit).get();
        }
      }
      let rows = snapshot.docs.map((doc) => normalizeDoc({ id: doc.id, ...doc.data() }));
      if (parsed.key === "members") {
        rows = rows.filter((row) => row.status !== "banned");
      }
      rows = sortRowsByField(rows, orderBy, "desc").slice(0, 200);

      if (parsed.key === "invites") {
        rows = rows
          .filter((row) => !shouldHideInviteFromActiveList(row))
          .map((row) => {
            if (typeof row.status === "string" && row.status === "pending_signup" && isInviteExpired(row)) {
              return { ...row, status: "expired" };
            }
            return row;
          });
      }

      rows = await applyVisibilityFilter(req, db, parsed.key, rows);
      let data =
        parsed.key === "invites"
          ? rows.map((row) => {
              const { invite_token: _t, inviteToken: _t2, ...rest } = row;
              return rest;
            })
          : rows;
      if (parsed.key === "team-members") {
        data = await enrichTeamMembersWithProfiles(db, data);
      }
      if (parsed.key === "team-projects") {
        data = await enrichTeamProjectsWithNames(db, data);
      }
      if (parsed.key === "invites" && requireManagementRole(getAuthContext(req))) {
        const PENDING_AUTH = "pending_auth_members";
        const pendingSnap = await db.collection(PENDING_AUTH).limit(200).get();
        for (const doc of pendingSnap.docs) {
          const p = doc.data() || {};
          const uid = doc.id;
          const email = typeof p.email === "string" ? p.email : "";
          const roleName =
            (await resolveRoleNameById(db, typeof p.role_id === "string" ? p.role_id : "")) ||
            (typeof p.role_name === "string" && p.role_name ? p.role_name : "Viewer");
          const payRate = typeof p.pay_rate === "number" && !Number.isNaN(p.pay_rate) ? p.pay_rate : 0;
          const createdAt = p.created_at;
          data.push({
            id: `pa_${uid}`,
            email,
            display_name: typeof p.display_name === "string" ? p.display_name : "",
            role_id: typeof p.role_id === "string" ? p.role_id : "",
            role_name: roleName,
            pay_rate: payRate,
            status: "pending_auth",
            invite_kind: "preprovision",
            sent_at: createdAt,
            accepted_at: null,
            created_by: "",
            updated_by: "",
            currency: "USD",
          });
        }
        const rowTimeMs = (r) => {
          const t = r.sent_at;
          if (t && typeof t.toDate === "function") return t.toDate().getTime();
          if (t instanceof Date) return t.getTime();
          if (typeof t === "string") {
            const n = Date.parse(t);
            return Number.isFinite(n) ? n : 0;
          }
          return 0;
        };
        data = [...data].sort((a, b) => rowTimeMs(b) - rowTimeMs(a));
        data = await enrichInvitesWithProjectCounts(db, data);
      }
      sendJson(res, origin, 200, { success: true, data });
      return true;
    }
    if (req.method === "GET" && parsed.id) {
      const doc = await resolveEntityDocRef(db, entity, parsed.id, taskParentId).get();
      if (!doc.exists) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      let row = normalizeDoc({ id: doc.id, ...doc.data() });
      const visible = await assertRowVisible(req, db, parsed.key, row);
      if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      if (parsed.key === "team-members") {
        const [enriched] = await enrichTeamMembersWithProfiles(db, [row]);
        row = enriched;
      }
      if (parsed.key === "team-projects") {
        const [enriched] = await enrichTeamProjectsWithNames(db, [row]);
        row = enriched;
      }
      if (parsed.key === "invites") {
        const { invite_token: _t, inviteToken: _t2, ...rest } = row;
        row = rest;
      }
      const [filtered] = await applyVisibilityFilter(req, db, parsed.key, [row]);
      sendJson(res, origin, 200, { success: true, data: filtered ?? row });
      return true;
    }
    if (req.method === "POST" && !parsed.id) {
      if (requiresManagementWriteGate(parsed.key) && !requireManagementRole(getAuthContext(req))) {
        return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
      }
      const body = await readJsonBody(req);
      const taskChildOk = await assertTaskChildWritable(req, res, origin, db, parsed.key, body, undefined);
      if (!taskChildOk) return true;
      const teamWriteOk = await assertTeamWriteAuthorized(req, res, origin, db, parsed.key, body, undefined, {
        method: "POST",
      });
      if (!teamWriteOk) return true;
      const projectWriteOk = await assertProjectWriteAuthorized(req, res, origin, db, parsed.key, body, undefined, undefined);
      if (!projectWriteOk) return true;
      if (parsed.key === TIME_ENTRY_WRITE_KEY) {
        const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, body, undefined);
        if (!timeEntryOk) return true;
      }
      const inviteExtras = parsed.key === "invites" ? ["role", "roleName", "payRate", "weeklyLimit"] : [];
      const teamRosterExtras =
        parsed.key === "teams"
          ? ["members", "member_ids", "memberIds", "lead_ids", "leadIds", "project_ids", "projectIds"]
          : [];
      const payload = buildCreatePayload(entity, body, {
        extraAllowedFields: [...inviteExtras, ...teamRosterExtras],
      });
      const viewer = getAuthContext(req);
      if (viewer?.memberId && TEAM_WRITE_KEYS.has(parsed.key)) {
        applyTeamWriteMetadata(parsed.key, payload, viewer.memberId, true);
      }
      validateRequiredFields(parsed.key, payload);
      if (parsed.key === "tasks") {
        const projectId =
          typeof payload.project_id === "string"
            ? payload.project_id
            : typeof body.projectId === "string"
              ? body.projectId
              : "";
        if (viewer && projectId) {
          const allowed = await getViewerProjectIds(db, viewer.memberId, viewer.roleName);
          if (allowed !== null && !allowed.includes(projectId)) {
            sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this project." });
            return true;
          }
          const canCreate = await viewerCanCreateProjectTasks(db, viewer, projectId);
          if (!canCreate) {
            sendJson(res, origin, 403, {
              success: false,
              error: "Only project managers can create tasks for this project.",
            });
            return true;
          }
        }
      }
      await validateBusinessRules(parsed.key, payload, db, {
        actorRoleName: getAuthContext(req)?.roleName ?? "",
      });
      await validateForeignKeys(db, payload, { entityKey: parsed.key });
      if (isTaskChildEntityKey(parsed.key) && taskParentId && !payload.task_id) {
        payload.task_id = taskParentId;
      }
      await resolveEntityDocRef(db, entity, payload.id, taskParentId).set(payload);
      if (parsed.key === "teams" && viewer?.memberId) {
        try {
          const roster = parseTeamRosterInput(body);
          const rosterError = validateTeamRoster(roster.memberIds, [...roster.leadIds]);
          if (rosterError) {
            const err = new Error(rosterError);
            err.statusCode = 400;
            throw err;
          }
          await createTeamInitialRoster(db, viewer, payload.id, roster);
        } catch (err) {
          await resolveEntityDocRef(db, entity, payload.id, taskParentId).delete().catch(() => {});
          const statusCode = typeof err?.statusCode === "number" ? err.statusCode : 400;
          sendJson(res, origin, statusCode, {
            success: false,
            error: err instanceof Error ? err.message : "Failed to create team roster.",
          });
          return true;
        }
      }
      if (parsed.key === "members") {
        await alignMemberRoleTables(db, payload.id, "schema-create");
      }

      // Trigger notification if task is created with an assignee
      if (parsed.key === "tasks") {
        const assigneeId = resolveTaskAssigneeId(payload, undefined);
        if (assigneeId) {
          await notifyTaskAssignee(db, assigneeId, payload.id, payload.title);
        }
      }

      if (parsed.key === TIME_ENTRY_WRITE_KEY) {
        const projectId = typeof payload.project_id === "string" ? payload.project_id : "";
        if (projectId) {
          await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
      }

      if (parsed.key === "client-projects") {
        const projectId = String(payload.project_id ?? payload.projectId ?? "").trim();
        if (projectId) {
          await syncProjectBudgetFromClients(db, projectId).catch(() => null);
          await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
      }

      sendJson(res, origin, 201, { success: true, data: normalizeDoc(payload) });
      return true;
    }
    if ((req.method === "PUT" || req.method === "PATCH") && parsed.id) {
      if (requiresManagementWriteGate(parsed.key) && !requireManagementRole(getAuthContext(req))) {
        return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
      }
      let body = await readJsonBody(req);
      if (parsed.key === "invites") {
        if (typeof body.role === "string" && body.role_name === undefined) body.role_name = body.role;
        if (typeof body.payRate === "number" && body.pay_rate === undefined) body.pay_rate = body.payRate;
        if (typeof body.weeklyLimit === "string" && body.weekly_limit === undefined) body.weekly_limit = body.weeklyLimit;
        if (typeof body.role_name === "string" && body.role_id === undefined) {
          body.role_id = await resolveRoleIdByName(db, body.role_name);
        }
      }
      const inviteExtras = parsed.key === "invites" ? ["role", "roleName", "payRate", "weeklyLimit"] : [];
      const teamRosterExtras =
        parsed.key === "teams"
          ? ["members", "member_ids", "memberIds", "lead_ids", "leadIds", "project_ids", "projectIds"]
          : [];
      const payload = buildUpdatePayload(entity, body, {
        extraAllowedFields: [...inviteExtras, ...teamRosterExtras],
      });
      const hasRosterUpdate =
        parsed.key === "teams" &&
        (Array.isArray(body.member_ids) ||
          Array.isArray(body.memberIds) ||
          Array.isArray(body.lead_ids) ||
          Array.isArray(body.leadIds) ||
          Array.isArray(body.project_ids) ||
          Array.isArray(body.projectIds) ||
          Array.isArray(body.members));
      if (Object.keys(payload).length === 0 && !hasRosterUpdate) {
        return sendJson(res, origin, 400, { success: false, error: "No valid fields to update" }), true;
      }
      const viewer = getAuthContext(req);
      if (viewer?.memberId && TEAM_WRITE_KEYS.has(parsed.key)) {
        applyTeamWriteMetadata(parsed.key, payload, viewer.memberId, false);
      }
      await validateBusinessRules(parsed.key, { ...payload, id: parsed.id }, db, {
        actorRoleName: getAuthContext(req)?.roleName ?? "",
      });
      const ref = resolveEntityDocRef(db, entity, parsed.id, taskParentId);
      const exists = await ref.get();
      if (!exists.exists) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      const existingData = exists.data() || {};
      const taskChildOk = await assertTaskChildWritable(req, res, origin, db, parsed.key, body, existingData);
      if (!taskChildOk) return true;
      const teamWriteOk = await assertTeamWriteAuthorized(req, res, origin, db, parsed.key, body, existingData, {
        method: req.method,
        resourceId: parsed.id,
      });
      if (!teamWriteOk) return true;
      const projectWriteOk = await assertProjectWriteAuthorized(req, res, origin, db, parsed.key, body, existingData, parsed.id);
      if (!projectWriteOk) return true;
      if (parsed.key === TIME_ENTRY_WRITE_KEY) {
        const timeEntryOk = await assertTimeEntryWriteAuthorized(req, res, origin, db, body, existingData);
        if (!timeEntryOk) return true;
      }
      if (TEAM_WRITE_KEYS.has(parsed.key)) {
        const visible = await assertRowVisible(req, db, parsed.key, { id: parsed.id, ...existingData });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      }
      if (PROJECT_WRITE_KEYS.has(parsed.key)) {
        const visible = await assertRowVisible(req, db, parsed.key, { id: parsed.id, ...existingData });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      }
      if (parsed.key === TIME_ENTRY_WRITE_KEY || parsed.key === "timesheets") {
        const visible = await assertRowVisible(req, db, parsed.key, { id: parsed.id, ...existingData });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      }
      if (parsed.key === "tasks") {
        const visible = await assertRowVisible(req, db, "tasks", { id: parsed.id, ...existingData });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      }
      const projectIdForFk = payload.project_id ?? existingData.project_id;
      await validateForeignKeys(db, payload, { projectId: projectIdForFk, entityKey: parsed.key });
      if (Object.keys(payload).length > 0) {
        await ref.update(payload);
      } else if (parsed.key === "teams" && viewer?.memberId) {
        await ref.update({ updated_by: viewer.memberId });
      }
      if (parsed.key === "teams" && viewer?.memberId && hasRosterUpdate) {
        try {
          const roster = parseTeamRosterInput(body);
          await syncTeamRoster(db, viewer, parsed.id, roster);
        } catch (err) {
          const statusCode = typeof err?.statusCode === "number" ? err.statusCode : 400;
          sendJson(res, origin, statusCode, {
            success: false,
            error: err instanceof Error ? err.message : "Failed to update team roster.",
          });
          return true;
        }
      }
      if (parsed.key === "members") {
        await alignMemberRoleTables(db, parsed.id, "schema-update");
      }
      
      // Trigger notification if task is assigned to a new person
      if (parsed.key === "tasks") {
        const nextAssignee = resolveTaskAssigneeId(payload, existingData);
        const prevAssignee = resolveTaskAssigneeId(existingData, undefined);
        if (nextAssignee && nextAssignee !== prevAssignee) {
          await notifyTaskAssignee(
            db,
            nextAssignee,
            parsed.id,
            payload.title || existingData.title,
          );
        }
      }

      if (parsed.key === TIME_ENTRY_WRITE_KEY) {
        const projectId = String(
          payload.project_id ?? existingData.project_id ?? existingData.projectId ?? "",
        ).trim();
        if (projectId) {
          await maybeNotifyClientBudgetsForProject(db, projectId).catch(() => null);
        }
      }

      const next = await ref.get();
      sendJson(res, origin, 200, { success: true, data: normalizeDoc({ id: next.id, ...next.data() }) });
      return true;
    }
    if (req.method === "DELETE" && parsed.id) {
      if (requiresManagementWriteGate(parsed.key) && !requireManagementRole(getAuthContext(req))) {
        return sendJson(res, origin, 403, { success: false, error: "Insufficient permissions for this operation." }), true;
      }
      if (parsed.key === "teams") {
        const teamId = parsed.id;
        const teamDoc = await db.collection(entity.collection).doc(teamId).get();
        if (!teamDoc.exists) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const visible = await assertRowVisible(req, db, "teams", { id: teamDoc.id, ...teamDoc.data() });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const batch = db.batch();
        const [teamMembersSnap, teamProjectsSnap] = await Promise.all([
          db.collection("team_members").where("team_id", "==", teamId).get(),
          db.collection("team_projects").where("team_id", "==", teamId).get(),
        ]);
        for (const doc of teamMembersSnap.docs) batch.delete(doc.ref);
        for (const doc of teamProjectsSnap.docs) batch.delete(doc.ref);
        batch.delete(db.collection(entity.collection).doc(teamId));
        await batch.commit();
        sendJson(res, origin, 200, { success: true, data: { id: teamId, deleted: true } });
        return true;
      }
      if (parsed.key === "projects") {
        const projectId = parsed.id;
        const projectDoc = await db.collection(entity.collection).doc(projectId).get();
        if (!projectDoc.exists) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const visible = await assertRowVisible(req, db, "projects", { id: projectDoc.id, ...projectDoc.data() });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const projectWriteOk = await assertProjectWriteAuthorized(req, res, origin, db, parsed.key, {}, projectDoc.data(), projectId);
        if (!projectWriteOk) return true;
        const batch = db.batch();
        const [membersSnap, teamLinksSnap, clientLinksSnap, budgetsSnap, limitsSnap] = await Promise.all([
          db.collection("project_members").where("project_id", "==", projectId).get(),
          db.collection("team_projects").where("project_id", "==", projectId).get(),
          db.collection("client_projects").where("project_id", "==", projectId).get(),
          db.collection("project_budgets").where("project_id", "==", projectId).get(),
          db.collection("project_member_limits").where("project_id", "==", projectId).get(),
        ]);
        for (const doc of membersSnap.docs) batch.delete(doc.ref);
        for (const doc of teamLinksSnap.docs) batch.delete(doc.ref);
        for (const doc of clientLinksSnap.docs) batch.delete(doc.ref);
        for (const doc of budgetsSnap.docs) batch.delete(doc.ref);
        for (const doc of limitsSnap.docs) batch.delete(doc.ref);
        batch.delete(db.collection(entity.collection).doc(projectId));
        await batch.commit();
        sendJson(res, origin, 200, { success: true, data: { id: projectId, deleted: true } });
        return true;
      }
      // Task deletion now handled above, inside the shouldRouteEntityToPostgres(tasks)
      // branch - deleteTaskWithChildren() moved there since tasks are Postgres-resident
      // now and this generic Firestore fallback path is no longer reached for "tasks".
      if (parsed.key === "invites") {
        await deleteInviteProjects(db, parsed.id);
      }
      if (TEAM_WRITE_KEYS.has(parsed.key) && parsed.key !== "teams") {
        const doc = await db.collection(entity.collection).doc(parsed.id).get();
        if (!doc.exists) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const existingData = doc.data() || {};
        const visible = await assertRowVisible(req, db, parsed.key, { id: doc.id, ...existingData });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const teamWriteOk = await assertTeamWriteAuthorized(req, res, origin, db, parsed.key, {}, existingData, {
          method: "DELETE",
          resourceId: parsed.id,
        });
        if (!teamWriteOk) return true;
      }
      if (PROJECT_WRITE_KEYS.has(parsed.key)) {
        const doc = await db.collection(entity.collection).doc(parsed.id).get();
        if (!doc.exists) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const existingData = doc.data() || {};
        const visible = await assertRowVisible(req, db, parsed.key, { id: doc.id, ...existingData });
        if (!visible) return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
        const projectWriteOk = await assertProjectWriteAuthorized(req, res, origin, db, parsed.key, {}, existingData, parsed.id);
        if (!projectWriteOk) return true;
      }
      if (parsed.key === TIME_ENTRY_WRITE_KEY || parsed.key === "timesheets") {
        return sendJson(res, origin, 404, { success: false, error: "Not found" }), true;
      }
      let projectIdToResyncBudget = null;
      if (parsed.key === "client-projects") {
        const linkDoc = await db.collection(entity.collection).doc(parsed.id).get();
        if (linkDoc.exists) {
          const row = linkDoc.data() || {};
          projectIdToResyncBudget = String(row.project_id ?? row.projectId ?? "").trim() || null;
        }
      }
      await resolveEntityDocRef(db, entity, parsed.id, taskParentId).delete();
      if (projectIdToResyncBudget) {
        await syncProjectBudgetFromClients(db, projectIdToResyncBudget).catch(() => null);
      }
      sendJson(res, origin, 200, { success: true, data: { id: parsed.id, deleted: true } });
      return true;
    }
    sendJson(res, origin, 405, { success: false, error: "Method not allowed" });
    return true;
  } catch (error) {
    sendJson(res, origin, 400, { success: false, error: error.message || "Invalid request" });
    return true;
  }
}
