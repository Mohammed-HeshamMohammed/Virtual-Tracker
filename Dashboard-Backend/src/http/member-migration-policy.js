import { getAuthContext } from "./auth-context.js";
import { sendJson } from "./response.js";
import { normalizeRoleKey } from "../modules/members/services/relation-sync.js";

/** Owner, Super Admin, and Admin may migrate existing Firebase Auth users into Virtual Tracker. */
export function canMigrateMembers(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin" || key === "admin";
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @returns {boolean}
 */
export function assertMigrationManagementRole(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return false;
  }
  if (!canMigrateMembers(viewer.roleName)) {
    sendJson(res, origin, 403, { success: false, error: "Only Owner, Super Admin, or Admin can migrate members." });
    return false;
  }
  return true;
}
