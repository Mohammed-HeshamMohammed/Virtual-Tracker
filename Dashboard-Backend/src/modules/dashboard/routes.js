import { requireAuthContext } from "../../http/auth-context.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { sendJson } from "../../http/response.js";
import { getDashboardCache, setDashboardCache } from "./dashboard-cache.js";
import { getCommandCenterPayload } from "./command-center-service.js";
import { getGeneralDashboardPayload } from "./general-dashboard-service.js";

export async function routeDashboard(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  if (pn === "/api/dashboard/command-center" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const cacheKey = `command-center:${viewer.memberId}`;
      let data = getDashboardCache(cacheKey);
      if (!data) {
        data = await getCommandCenterPayload(db, viewer.memberId);
        setDashboardCache(cacheKey, data);
      }
      sendJson(res, origin, 200, { success: true, data }, req);
    } catch (e) {
      logSafeError("[dashboard/command-center]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load command center",
      });
    }
    return true;
  }

  if (pn === "/api/dashboard/general" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    try {
      const cacheKey = `general:${viewer.memberId}`;
      let data = getDashboardCache(cacheKey);
      if (!data) {
        data = await getGeneralDashboardPayload(db, viewer.memberId);
        setDashboardCache(cacheKey, data);
      }
      sendJson(res, origin, 200, { success: true, data }, req);
    } catch (e) {
      logSafeError("[dashboard/general]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load general dashboard",
      });
    }
    return true;
  }

  return false;
}
