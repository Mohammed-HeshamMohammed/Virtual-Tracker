import { COLLECTIONS } from "../lib/firestore/collections.js";
import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";

function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * Project IDs the viewer may access. `null` = all projects (owner).
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 * @param {string} viewerRole
 * @returns {Promise<string[] | null>}
 */
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
  const pmSnap = await db
    .collection("project_members")
    .where("member_id", "==", viewerMemberId)
    .select("project_id")
    .limit(200)
    .get();
  for (const doc of pmSnap.docs) {
    const pid = String(doc.data()?.project_id ?? "").trim();
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

/**
 * Whether the viewer may write project-scoped rows (members, budgets, team links).
 * Includes projects the viewer created but has not yet been added to as a member.
 *
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

  const projectDoc = await db.collection(COLLECTIONS.projects).doc(pid).get();
  if (!projectDoc.exists) return false;
  const row = projectDoc.data() || {};
  const createdBy = String(row.created_by ?? row.createdBy ?? "").trim();
  return createdBy === viewer.memberId;
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
