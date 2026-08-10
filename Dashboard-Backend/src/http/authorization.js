import { getAuthContext, isManagementRole, requireManagementRole } from "./auth-context.js";
import { sendJson } from "./response.js";
import { getVisibleMemberIds, getManageableMemberIds } from "../modules/member-relationships/service.js";
import { resolveMemberRoleName } from "../modules/activity/activity-scope.js";
import { canActorManageTargetRole } from "./role-manage-policy.js";
import { isPostgresConfigured, query } from "../lib/postgres/client.js";

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 * @param {string} viewerRole
 * @param {string} targetMemberId
 */
export async function canAccessMember(db, viewerMemberId, viewerRole, targetMemberId) {
  if (!viewerMemberId || !targetMemberId) return false;
  if (viewerMemberId === targetMemberId) return true;
  const visibleIds = await getVisibleMemberIds(db, viewerMemberId, viewerRole);
  if (visibleIds === null) return true;
  return visibleIds.includes(targetMemberId);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 * @param {string} viewerRole
 * @param {string} targetMemberId
 */
export async function canManageMember(db, viewerMemberId, viewerRole, targetMemberId) {
  if (!viewerMemberId || !targetMemberId) return false;
  if (viewerMemberId === targetMemberId) return true;

  if (isPostgresConfigured()) {
    try {
      const rows = await query("SELECT fn_can_actor_manage_target($1, $2) AS allowed", [viewerMemberId, targetMemberId]);
      if (typeof rows[0]?.allowed === "boolean") return rows[0].allowed;
    } catch {
      // Fall back safely to JS evaluation if function is unavailable
    }
  }

  const targetRoleName = await resolveMemberRoleName(db, targetMemberId);
  if (!canActorManageTargetRole(viewerRole, targetRoleName)) return false;

  const manageableIds = await getManageableMemberIds(db, viewerMemberId, viewerRole);
  if (manageableIds === null) return true;
  return manageableIds.includes(targetMemberId);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} targetMemberId
 * @returns {Promise<boolean>}
 */
export async function assertMemberAccessible(req, res, origin, db, targetMemberId) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  const allowed = await canAccessMember(db, viewer.memberId, viewer.roleName, targetMemberId);
  if (!allowed) {
    sendJson(res, origin, 404, { success: false, error: "Not found." });
    return false;
  }
  return true;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @returns {boolean}
 */
export function assertManagementRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  if (!requireManagementRole(viewer)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
    return false;
  }
  return true;
}

/** Owner / Super Admin only — destructive org ops. */
export function assertOrgAdminRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  const role = String(viewer.roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (role !== "owner" && role !== "superadmin") {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
    return false;
  }
  return true;
}

export { isManagementRole, requireManagementRole };
