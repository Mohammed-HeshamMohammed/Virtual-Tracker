import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";
import {
  getProjectPg,
  listClientManagedProjectIdsPg,
  listClientTrackableProjectIdsPg,
  listViewerProjectIdsPg,
} from "../lib/postgres/projects-postgres.service.js";
import { query } from "../lib/postgres/client.js";
import { normalizeRoleKey } from "./role-key.js";

function normalizeRole(roleName) {
  // Delegates to the canonical normalizer - a local copy here would
  // drop the legacy-misspelling fold and silently mis-rank "Super Manger".
  return normalizeRoleKey(roleName);
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

  // Membership rows, projects the viewer created (createProjectPg stamps
  // created_by without inserting a membership row), and - for a client member
  // - the projects assigned to their client. See listViewerProjectIdsPg.
  return listViewerProjectIdsPg(viewerMemberId);
}

/**
 * Whether this viewer may write to a project as its client.
 *
 * A client reads every project linked to them, but writes to none of it
 * unless that project has client_can_manage turned on.
 * @param {{ memberId: string; roleName: string }} viewer
 * @param {string} projectId
 */
export async function clientMayManageProject(viewer, projectId) {
  if (!viewer?.memberId || !projectId) return false;
  if (normalizeRole(viewer.roleName) !== "client") return false;
  const managed = await listClientManagedProjectIdsPg(viewer.memberId);
  return managed.has(projectId);
}

/**
 * Whether this viewer may run a task-less timer on this project as its
 * client - the tracking equivalent of clientMayManageProject, gated by the
 * independent client_can_track flag instead of client_can_manage.
 * @param {{ memberId: string; roleName: string }} viewer
 * @param {string} projectId
 */
export async function clientMayTrackProject(viewer, projectId) {
  if (!viewer?.memberId || !projectId) return false;
  if (normalizeRole(viewer.roleName) !== "client") return false;
  const trackable = await listClientTrackableProjectIdsPg(viewer.memberId);
  return trackable.has(projectId);
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
  if (roleKey === "client") return clientMayManageProject(viewer, pid);

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

  const roleKey = normalizeRole(viewer.roleName);
  if (ORG_PROJECT_TASK_ADMIN_ROLES.has(roleKey)) return true;
  // A client is never a project_members row (their link is client_projects,
  // a different table) - client_can_track is its own equivalent of
  // "membership" for this specific check, same pattern clientMayManageProject
  // already is for the write-access check.
  if (roleKey === "client") return clientMayTrackProject(viewer, pid);

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

  // A client now appears in getViewerProjectIds for every project linked to
  // them, which is a read scope. Writing needs the per-project switch, so the
  // client leg is decided here before the generic membership check below
  // would wave it through.
  if (normalizeRole(viewer.roleName) === "client") {
    return clientMayManageProject(viewer, pid);
  }

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
