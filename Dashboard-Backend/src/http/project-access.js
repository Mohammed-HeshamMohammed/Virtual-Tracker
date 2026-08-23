import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";
import { getProjectPg, listProjectIdsForMemberPg } from "../lib/postgres/projects-postgres.service.js";
import { query } from "../lib/postgres/client.js";

function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Project ids viewer can access; null = all (Owner). */
export async function getViewerProjectIds(db, viewerMemberId, viewerRole) {
  if (!viewerMemberId) return [];
  const roleKey = normalizeRole(viewerRole);
  if (
    roleKey === "owner" ||
    roleKey === "superadmin" ||
    roleKey === "admin" ||
    roleKey === "supermanager" ||
    roleKey === "supermanger"
  ) {
    return null;
  }

  // Union with projects the viewer created but was never added as a
  // project_members row for (createProjectPg only stamps created_by, it
  // doesn't also insert a membership row) - every other visibility check in
  // the codebase (schema/visibility.js's "projects"/"tasks" filters,
  // viewerCanWriteProject below) already falls back to created_by; this was
  // the one place that didn't, which made a non-admin's own newly-created
  // projects (and their tasks) invisible to the two Overview endpoints that
  // scope purely off this function's return value.
  const [memberProjectIds, createdRows] = await Promise.all([
    listProjectIdsForMemberPg(viewerMemberId),
    query("SELECT id FROM projects WHERE created_by = $1", [viewerMemberId]),
  ]);
  return [...new Set([...memberProjectIds, ...createdRows.map((r) => r.id)])];
}

const ORG_PROJECT_TASK_ADMIN_ROLES = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger",
]);

/** Owner/Super Admin/Admin/Super Manager - same org-admin set task-creation
 * already uses. Also gates client budget figures (financial data). */
export function isOrgProjectAdminRole(roleName) {
  return ORG_PROJECT_TASK_ADMIN_ROLES.has(normalizeRole(roleName));
}

function normalizeProjectRole(role) {
  const value = String(role || "")
    .trim()
    .toLowerCase();
  if (value === "managers") return "manager";
  if (value === "users" || value === "user") return "user";
  if (value === "viewers" || value === "viewer") return "viewer";
  return value;
}

/**
 * Org admins or project_members with project_role manager may create tasks.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string; roleName: string }} viewer
 * @param {string} projectId
 */
export async function viewerCanCreateProjectTasks(db, viewer, projectId) {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (!viewer?.memberId || !pid) return false;

  const roleKey = normalizeRole(viewer.roleName);
  if (ORG_PROJECT_TASK_ADMIN_ROLES.has(roleKey)) return true;

  const rows = await query(
    "SELECT project_role FROM project_members WHERE project_id = $1 AND member_id = $2 LIMIT 10",
    [pid, viewer.memberId],
  );

  return rows.some((row) => normalizeProjectRole(row.project_role) === "manager");
}

/**
 * May start a project-scoped (task-less) timer on this project. Calling
 * projects have no task assignment to gate on, so project membership in any
 * role is the equivalent check - plus org admins, who can already start a
 * timer on any task in any project.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string; roleName: string }} viewer
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
export async function isProjectMemberForTimer(db, viewer, projectId) {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (!viewer?.memberId || !pid) return false;

  if (ORG_PROJECT_TASK_ADMIN_ROLES.has(normalizeRole(viewer.roleName))) return true;

  const rows = await query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND member_id = $2 LIMIT 1",
    [pid, viewer.memberId],
  );
  return rows.length > 0;
}

/**
 * Can write project rows (includes projects viewer created but isn't a member of yet).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string; roleName: string }} viewer
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
export async function viewerCanWriteProject(db, viewer, projectId) {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (!pid || !viewer?.memberId) return false;

  const allowedProjects = await getViewerProjectIds(db, viewer.memberId, viewer.roleName);
  if (allowedProjects === null) return true;
  if (allowedProjects.includes(pid)) return true;

  const project = await getProjectPg(pid);
  if (!project) return false;
  return String(project.created_by ?? "").trim() === viewer.memberId;
}

/**
 * @param {string[] | null} allowedProjectIds
 * @returns {Set<string> | null}
 */
export function toAllowedProjectSet(allowedProjectIds) {
  if (allowedProjectIds === null) return null;
  return new Set(allowedProjectIds);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 */
export async function assertProjectAccessible(req, res, origin, db, projectId) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  const allowed = await getViewerProjectIds(db, viewer.memberId, viewer.roleName);
  if (allowed === null) return true;
  if (allowed.includes(projectId)) return true;
  if (await viewerCanWriteProject(db, viewer, projectId)) return true;
  sendJson(res, origin, 404, { success: false, error: "Not found." });
  return false;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @returns {boolean}
 */
export function assertAuthenticated(req, res, origin) {
  if (getAuthContext(req)) return true;
  sendJson(res, origin, 401, { success: false, error: "Authorization required." });
  return false;
}
