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

  const ids = new Set();
  for (const pid of await listProjectIdsForMemberPg(viewerMemberId)) {
    if (pid) ids.add(pid);
  }

  const memberDoc = await db.collection("members").doc(viewerMemberId).get();
  if (memberDoc.exists) {
    const legacyProjects = memberDoc.data()?.projects;
    if (Array.isArray(legacyProjects)) {
      for (const pid of legacyProjects) {
        if (pid) ids.add(String(pid));
      }
    }
  }

  return [...ids];
}

const ORG_PROJECT_TASK_ADMIN_ROLES = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "supermanger",
]);

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
