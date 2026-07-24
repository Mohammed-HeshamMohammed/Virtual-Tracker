import { query } from "../../lib/postgres/client.js";
import { requireAuthContext } from "../../http/auth-context.js";
import { sendJson } from "../../http/response.js";
import { listNotificationsForMember, markAllNotificationsAsRead, markNotificationAsRead } from "./service.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>} true if handled
 */
export async function routeNotifications(req, res, url, origin) {
  if (!url.pathname.startsWith("/api/notifications")) return false;

  const viewer = requireAuthContext(req, res, origin);
  if (!viewer) return true;

  const memberId = viewer.memberId;

  // GET /api/notifications
  if (url.pathname === "/api/notifications" && req.method === "GET") {
    try {
      const data = await listNotificationsForMember(null, memberId);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/notifications/:id/read
  const readMatch = /^\/api\/notifications\/([^/]+)\/read$/.exec(url.pathname);
  if (readMatch && req.method === "POST") {
    const notificationId = readMatch[1];
    try {
      const success = await markNotificationAsRead(null, notificationId, memberId);
      if (success) {
        sendJson(res, origin, 200, { success: true });
      } else {
        sendJson(res, origin, 404, { success: false, error: "Notification not found or unauthorized" });
      }
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // POST /api/notifications/read-all
  if (url.pathname === "/api/notifications/read-all" && req.method === "POST") {
    try {
      await markAllNotificationsAsRead(null, memberId);
      sendJson(res, origin, 200, { success: true });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  // DELETE /api/notifications/:id
  const deleteMatch = /^\/api\/notifications\/([^/]+)$/.exec(url.pathname);
  if (deleteMatch && req.method === "DELETE") {
    const notificationId = deleteMatch[1];
    try {
      const rows = await query(
        `DELETE FROM notifications WHERE id = $1 AND recipient_id = $2 RETURNING id`,
        [notificationId, memberId],
      );
      if (rows.length === 0) {
        sendJson(res, origin, 404, { success: false, error: "Not found or unauthorized" });
        return true;
      }
      sendJson(res, origin, 200, { success: true });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e.message });
    }
    return true;
  }

  return false;
}
