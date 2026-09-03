import { sendJson } from "../../http/response.js";
import { requireInternalAuth } from "../../http/internal-auth.js";
import { getMessaging } from "../../config/firebase.js";
import { isDuplicate, logDelivery } from "../notify-log/notify-log.service.js";

export async function routePush(req, res, url, origin) {
  if (url.pathname !== "/api/notify/push" || req.method !== "POST") return false;

  if (!requireInternalAuth(req, res, origin)) return true;

  const messaging = await getMessaging();
  if (!messaging) {
    sendJson(res, origin, 503, {
      success: false,
      error:
        "Push notifications not configured. " +
        "Set FIREBASE_SERVICE_ACCOUNT in Notify-Backend/.env",
    });
    return true;
  }

  const body = await readBody(req);

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

  const recipient = String(body.token || body.topic || body.condition);
  const template = typeof body.template === "string" ? body.template.trim() : "push";
  const recipientMemberId = typeof body.recipientMemberId === "string" ? body.recipientMemberId : null;

  const dupe = await isDuplicate({ recipient, template, channel: "push" });
  if (dupe) {
    await logDelivery({
      channel: "push",
      template,
      recipient,
      recipientMemberId,
      status: "skipped",
      metadata: { reason: "cooldown" },
    });
    sendJson(res, origin, 200, { success: true, sent: false, channel: "skipped" });
    return true;
  }

  try {
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

    await logDelivery({
      channel: "push",
      template,
      recipient,
      recipientMemberId,
      status: "sent",
      metadata: { messageId, title: body.title },
    });

    sendJson(res, origin, 200, { success: true, messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Push delivery failed";
    console.warn("[push] FCM send failed:", msg);

    await logDelivery({
      channel: "push",
      template,
      recipient,
      recipientMemberId,
      status: "failed",
      errorMessage: msg,
    });

    sendJson(res, origin, 500, { success: false, error: msg });
  }

  return true;
}

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
