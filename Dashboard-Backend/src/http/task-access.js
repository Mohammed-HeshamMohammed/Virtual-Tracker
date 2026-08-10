import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";
import { getViewerProjectIds } from "./project-access.js";
import { canEditTeam } from "./team-edit-access.js";
import { isManagementRole, isReviewCenterRole } from "../modules/tasks/task-assignments.js";
import { getTaskPg } from "../lib/postgres/tasks-postgres.service.js";
import { hasAssignmentPg } from "../lib/postgres/task-assignments-postgres.service.js";

function str(row, ...keys) {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 * @param {string} viewerRole
 * @param {string} taskId
 */
export async function canAccessTask(db, viewerMemberId, viewerRole, taskId) {
  const task = await getTaskPg(taskId);
  if (!task) return { allowed: false, status: 404, task: null };

  if (isManagementRole(viewerRole)) return { allowed: true, status: 200, task };

  const assigneeId = str(task, "assigned_to", "assignedTo");
  const createdBy = str(task, "created_by", "createdBy");
  if (viewerMemberId && (assigneeId === viewerMemberId || createdBy === viewerMemberId)) {
    return { allowed: true, status: 200, task };
  }

  if (await hasAssignmentPg(taskId, viewerMemberId)) return { allowed: true, status: 200, task };

  const projectId = str(task, "project_id", "projectId");
  if (projectId) {
    const allowedProjects = await getViewerProjectIds(db, viewerMemberId, viewerRole);
    if (allowedProjects === null || allowedProjects.includes(projectId)) {
      return { allowed: true, status: 200, task };
    }
  }

  return { allowed: false, status: 404, task: null };
}

/** Task creators, team leads, and management may sync multi-assignee rows. */
export async function canSyncTaskAssignments(db, viewerMemberId, viewerRole, task) {
  if (isManagementRole(viewerRole)) return true;

  const createdBy = str(task, "created_by", "createdBy");
  if (viewerMemberId && createdBy && createdBy === viewerMemberId) return true;

  const teamId = str(task, "team_id", "teamId");
  if (teamId && (await canEditTeam(db, viewerMemberId, viewerRole, teamId))) return true;

  return false;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} taskId
 */
export async function assertTaskAccessible(req, res, origin, db, taskId) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return null;
  }
  const result = await canAccessTask(db, viewer.memberId, viewer.roleName, taskId);
  if (!result.allowed) {
    sendJson(res, origin, result.status, { success: false, error: "Not found." });
    return null;
  }
  return { viewer, task: result.task };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 */
export function assertCanReviewTasks(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return null;
  }
  if (!isReviewCenterRole(viewer.roleName)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to review tasks." });
    return null;
  }
  return viewer;
}
