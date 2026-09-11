import { requireAuthContext } from "../../http/auth-context.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import {
  clearNotifications,
  countUnreadNotifications,
  deleteNotification,
  isNotificationId,
  listNotificationsForMember,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  markNotificationsAsRead,
  parseNotificationIds,
} from "./service.js";

/** The JSON body as an object, or null once a 400 has been sent. */
async function readObjectBody(req, res, origin) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, origin, 400, { success: false, error: e.message });
    return null;
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

// GET    /api/notifications            the latest 30, plus the true unread count
// POST   /api/notifications/:id/read   mark one read
// POST   /api/notifications/read       mark several read       { ids }
// POST   /api/notifications/read-all   mark every one read
// DELETE /api/notifications/:id        clear one
// POST   /api/notifications/clear      clear several           { ids } | { readOnly: true } | { all: true }
//
// Everything is scoped to the signed-in member's own notifications.
export async function routeNotifications(req, res, url, origin) {
  if (!url.pathname.startsWith("/api/notifications")) return false;

  const viewer = requireAuthContext(req, res, origin);
  if (!viewer) return true;

  const memberId = viewer.memberId;

  try {
    if (url.pathname === "/api/notifications" && req.method === "GET") {
      const [data, unreadCount] = await Promise.all([
        listNotificationsForMember(null, memberId),
        countUnreadNotifications(null, memberId),
      ]);
      sendJson(res, origin, 200, { success: true, data, unreadCount });
      return true;
    }

    if (url.pathname === "/api/notifications/read-all" && req.method === "POST") {
      await markAllNotificationsAsRead(null, memberId);
      sendJson(res, origin, 200, { success: true });
      return true;
    }

    if (url.pathname === "/api/notifications/read" && req.method === "POST") {
      const body = await readObjectBody(req, res, origin);
      if (!body) return true;
      const parsed = parseNotificationIds(body.ids);
      if (parsed.error) {
        sendJson(res, origin, 400, { success: false, error: parsed.error });
        return true;
      }
      const updated = await markNotificationsAsRead(null, memberId, parsed.ids);
      sendJson(res, origin, 200, { success: true, updated });
      return true;
    }

    if (url.pathname === "/api/notifications/clear" && req.method === "POST") {
      const body = await readObjectBody(req, res, origin);
      if (!body) return true;
      let options;
      if (body.ids !== undefined) {
        const parsed = parseNotificationIds(body.ids);
        if (parsed.error) {
          sendJson(res, origin, 400, { success: false, error: parsed.error });
          return true;
        }
        options = { ids: parsed.ids };
      } else if (body.readOnly === true) {
        options = { readOnly: true };
      } else if (body.all === true) {
        // Deliberately explicit: an empty or malformed request must never
        // wipe someone's notifications.
        options = {};
      } else {
        sendJson(res, origin, 400, {
          success: false,
          error: "Say which notifications to clear: ids, readOnly: true, or all: true.",
        });
        return true;
      }
      const cleared = await clearNotifications(null, memberId, options);
      sendJson(res, origin, 200, { success: true, cleared });
      return true;
    }

    const readMatch = /^\/api\/notifications\/([^/]+)\/read$/.exec(url.pathname);
    if (readMatch && req.method === "POST") {
      const notificationId = readMatch[1];
      const success = isNotificationId(notificationId) && (await markNotificationAsRead(null, notificationId, memberId));
      if (success) {
        sendJson(res, origin, 200, { success: true });
      } else {
        sendJson(res, origin, 404, { success: false, error: "Notification not found or unauthorized" });
      }
      return true;
    }

    const deleteMatch = /^\/api\/notifications\/([^/]+)$/.exec(url.pathname);
    if (deleteMatch && req.method === "DELETE") {
      const notificationId = deleteMatch[1];
      const deleted = isNotificationId(notificationId) && (await deleteNotification(null, notificationId, memberId));
      if (deleted) {
        sendJson(res, origin, 200, { success: true });
      } else {
        sendJson(res, origin, 404, { success: false, error: "Not found or unauthorized" });
      }
      return true;
    }
  } catch (e) {
    sendJson(res, origin, 500, { success: false, error: e.message });
    return true;
  }

  return false;
}
