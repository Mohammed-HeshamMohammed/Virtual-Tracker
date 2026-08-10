import { sendJson } from "./response.js";

/** @typedef {{ uid: string, memberId: string, roleName: string, roleId?: string, hierarchyLevel?: number, isManagement?: boolean, securityStamp?: string, email?: string }} AuthContext */

const AUTH_CONTEXT = Symbol("vtAuthContext");

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {AuthContext} context
 */
export function setAuthContext(req, context) {
  /** @type {Record<symbol, AuthContext>} */ (req)[AUTH_CONTEXT] = context;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {AuthContext | null}
 */
export function getAuthContext(req) {
  return /** @type {Record<symbol, AuthContext | undefined>} */ (req)[AUTH_CONTEXT] ?? null;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @returns {AuthContext | null}
 */
export function requireAuthContext(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return null;
  }
  return viewer;
}

/**
 * Management roles that may view compensation data and perform admin actions.
 * @param {string} roleName
 */
export function isManagementRole(roleName) {
  const key = String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return ["owner", "superadmin", "admin", "supermanager", "supermanger", "manager"].includes(key);
}

/**
 * @param {AuthContext | null | undefined} context
 */
export function requireManagementRole(context) {
  if (!context) return false;
  if (context.isManagement === true || (typeof context.hierarchyLevel === "number" && context.hierarchyLevel >= 50)) {
    return true;
  }
  return isManagementRole(context.roleName);
}
