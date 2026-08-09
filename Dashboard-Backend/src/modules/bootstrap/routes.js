import { requireAuthContext } from "../../http/auth-context.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { getBootstrapPayload } from "./bootstrap-service.js";
import { getBootstrapWarmPayload } from "./bootstrap-warm-service.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeBootstrap(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  if (pn === "/api/bootstrap/warm" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const warm = await getBootstrapWarmPayload(db, viewer);
      sendJson(res, origin, 200, { success: true, data: warm }, req);
    } catch (e) {
      logSafeError("[bootstrap/warm]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load bootstrap warm data",
      });
    }
    return true;
  }

  if (pn === "/api/bootstrap" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const data = await getBootstrapPayload(db, viewer);
      sendJson(res, origin, 200, { success: true, data }, req);
    } catch (e) {
      const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) || 500 : 500;
      const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : undefined;
      logSafeError("[bootstrap]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load bootstrap data",
        ...(code ? { code } : {}),
      });
    }
    return true;
  }

  return false;
}
