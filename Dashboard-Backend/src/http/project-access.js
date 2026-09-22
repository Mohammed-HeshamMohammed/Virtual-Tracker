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
  return normalizeRoleKey(roleName);
}

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

  return listViewerProjectIdsPg(viewerMemberId);
}

export async function clientMayManageProject(viewer, projectId) {
  if (!viewer?.memberId || !projectId) return false;
  if (normalizeRole(viewer.roleName) !== "client") return false;
  const managed = await listClientManagedProjectIdsPg(viewer.memberId);
  return managed.has(projectId);
}

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
  if (rows.length === 0) return false;

  const project = await getProjectPg(pid);
  if (project?.restrict_task_creation === false) return true;

  return rows.some((row) => normalizeProjectRole(row.project_role) === "manager");
}

export async function isProjectMemberForTimer(db, viewer, projectId) {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (!viewer?.memberId || !pid) return false;

  const roleKey = normalizeRole(viewer.roleName);
  if (ORG_PROJECT_TASK_ADMIN_ROLES.has(roleKey)) return true;
  if (roleKey === "client") return clientMayTrackProject(viewer, pid);

  const rows = await query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND member_id = $2 LIMIT 1",
    [pid, viewer.memberId],
  );
  return rows.length > 0;
}

/**
 * Same access rule as isProjectMemberForTimer, as a list instead of a single
 * (member, project) check - every project id this member could actually
 * clock in on. Used to scope the Project dropdown in "add manual time for
 * someone" flows to what the *target* member can track, not what the
 * manager doing the backfill happens to see - a manager assigned to a
 * project isn't automatically a trackable member of it themselves (e.g. a
 * viewer-role assignment), and a member with no project_members row at all
 * (not currently on the project) can't clock in regardless of role.
 * @returns {Promise<string[] | null>} null means "every project" (org admin tier).
 */
export async function listTrackableProjectIdsPg(memberId, roleName) {
  const id = typeof memberId === "string" ? memberId.trim() : "";
  if (!id) return [];
  const roleKey = normalizeRole(roleName);
  if (ORG_PROJECT_TASK_ADMIN_ROLES.has(roleKey)) return null;
  if (roleKey === "client") return [...(await listClientTrackableProjectIdsPg(id))];

  const rows = await query("SELECT project_id FROM project_members WHERE member_id = $1", [id]);
  return rows.map((r) => String(r.project_id)).filter(Boolean);
}

export async function viewerCanWriteProject(db, viewer, projectId) {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (!pid || !viewer?.memberId) return false;

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

export function toAllowedProjectSet(allowedProjectIds) {
  if (allowedProjectIds === null) return null;
  return new Set(allowedProjectIds);
}

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

export function assertAuthenticated(req, res, origin) {
  if (getAuthContext(req)) return true;
  sendJson(res, origin, 401, { success: false, error: "Authorization required." });
  return false;
}
