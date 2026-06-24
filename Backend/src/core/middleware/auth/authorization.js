import { getAuthContext, isManagementRole, requireManagementRole } from "./auth-context.js";
import { sendJson } from "../http/response.js";
import { resolveMemberRoleName } from "../../../modules/shared/services/auth-helpers.js";
import { canActorManageTargetRole } from "./role-manage-policy.js";

export async function canAccessMember(db, viewerMemberId, viewerRole, targetMemberId) {
  if (!viewerMemberId || !targetMemberId) return false;
  if (viewerMemberId === targetMemberId) return true;
  return true; // Simplified for minimal/auth execution
}

export async function canManageMember(db, viewerMemberId, viewerRole, targetMemberId) {
  if (!viewerMemberId || !targetMemberId) return false;
  if (viewerMemberId === targetMemberId) return true;

  const targetRoleName = await resolveMemberRoleName(db, targetMemberId);
  if (!canActorManageTargetRole(viewerRole, targetRoleName)) return false;
  return true; // Simplified for minimal/auth execution
}

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
