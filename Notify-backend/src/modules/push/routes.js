/**
 * Push notification route — POST /api/notify/push
 *
 * Sends push notifications via Firebase Cloud Messaging (FCM HTTP v1 API)
 * using the Firebase Admin SDK and a service account.
 *
 * Requires in .env:
 *   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   OR
 *   FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 */
import { sendJson } from "../../http/response.js";
import { requireInternalAuth } from "../../http/internal-auth.js";
import { getMessaging } from "../../config/firebase.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routePush(req, res, url, origin) {
  if (url.pathname !== "/api/notify/push" || req.method !== "POST") return false;

  if (!requireInternalAuth(req, res, origin)) return true;

  const messaging = await getMessaging();
  if (!messaging) {
    sendJson(res, origin, 503, {
      success: false,
      error:
        "Push notifications not configured. " +
        "Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_CLIENT_EMAIL+FIREBASE_PRIVATE_KEY in Notify-Backend/.env",
    });
    return true;
  }

  const body = await readBody(req);

  // Validate required fields
  if (!body.token && !body.topic && !body.condition) {
    sendJson(res, origin, 400, {
      success: false,
      error: "One of token, topic, or condition is required",
    });
    return true;
  }
  if (!body.title || !body.body) {
    sendJson(res, origin, 400, {
      success: false,
      error: "title and body are required",
    });
    return true;
  }

  try {
    /** @type {import("firebase-admin/messaging").Message} */
    const message = {
      notification: {
        title: String(body.title),
        body: String(body.body),
        ...(body.imageUrl ? { imageUrl: String(body.imageUrl) } : {}),
      },
      webpush: {
        notification: {
          title: String(body.title),
          body: String(body.body),
          ...(body.icon ? { icon: String(body.icon) } : {}),
          ...(body.link ? { data: { link: String(body.link) } } : {}),
        },
        ...(body.link
          ? { fcmOptions: { link: String(body.link) } }
          : {}),
      },
      ...(body.data ? { data: flattenData(body.data) } : {}),
      ...(body.token ? { token: String(body.token) } : {}),
      ...(body.topic ? { topic: String(body.topic) } : {}),
      ...(body.condition ? { condition: String(body.condition) } : {}),
    };

    const messageId = await messaging.send(message);
    sendJson(res, origin, 200, { success: true, messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Push delivery failed";
    console.warn("[push] FCM send failed:", msg);
    sendJson(res, origin, 500, { success: false, error: msg });
  }

  return true;
}

/**
 * FCM data payload requires all values to be strings.
 * @param {Record<string, unknown>} data
 * @returns {Record<string, string>}
 */
function flattenData(data) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}
