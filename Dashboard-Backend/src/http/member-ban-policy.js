import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";
import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";

export function canManageMemberBans(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin" || key === "admin";
}

export function assertBanManagementRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  if (!canManageMemberBans(viewer.roleName)) {
    sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
    return false;
  }
  return true;
}
