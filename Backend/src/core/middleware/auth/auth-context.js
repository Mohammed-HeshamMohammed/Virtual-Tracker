import { sendJson } from "../http/response.js";

const AUTH_CONTEXT = Symbol("vtAuthContext");

export function setAuthContext(req, context) {
  req[AUTH_CONTEXT] = context;
}

export function getAuthContext(req) {
  return req[AUTH_CONTEXT] ?? null;
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
  return Boolean(context && isManagementRole(context.roleName));
}
