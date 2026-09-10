import { sendJson } from "./response.js";
import { setAuditActor } from "../lib/postgres/audit-actor.js";


const AUTH_CONTEXT = Symbol("vtAuthContext");

export function setAuthContext(req, context) {
 (req)[AUTH_CONTEXT] = context;
  // The one place a request's viewer becomes known, so it is the one place
  // that has to tell the database who is about to write (see audit-actor.js).
  setAuditActor(context?.memberId);
}

export function getAuthContext(req) {
  return /** @type {Record<symbol, AuthContext | undefined>} */ (req)[AUTH_CONTEXT] ?? null;
}

export function requireAuthContext(req, res, origin) {
  const viewer = getAuthContext(req);
  if (!viewer) {
    sendJson(res, origin, 401, { success: false, error: "Authorization required." });
    return null;
  }
  return viewer;
}

export function isManagementRole(roleName) {
  const key = String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return ["owner", "superadmin", "admin", "supermanager", "supermanger", "manager"].includes(key);
}

export function requireManagementRole(context) {
  if (!context) return false;
  if (context.isManagement === true || (typeof context.hierarchyLevel === "number" && context.hierarchyLevel >= 50)) {
    return true;
  }
  return isManagementRole(context.roleName);
}
