/**
 * Email routes — POST /api/notify/email
 * Accepts template-ID + userId only. Never raw content from the caller.
 */
import { sendJson } from "../../http/response.js";
import { requireInternalAuth } from "../../http/internal-auth.js";
import {
  sendEmailVerificationEmail,
  sendPasswordUpdatedEmail,
  sendNewSignInAlertEmail,
  sendPhoneVerifiedEmail,
} from "./email-builders.js";

const ALLOWED_TEMPLATES = new Set([
  "verification",
  "password-updated",
  "new-sign-in-alert",
  "phone-verified",
]);

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeEmail(req, res, url, origin) {
  if (!url.pathname.startsWith("/api/notify/email")) return false;

  if (!requireInternalAuth(req, res, origin)) return true;

  if (url.pathname === "/api/notify/email" && req.method === "POST") {
    const body = await readBody(req);
    const template = typeof body?.template === "string" ? body.template.trim() : "";
    if (!ALLOWED_TEMPLATES.has(template)) {
      sendJson(res, origin, 400, { success: false, error: `Unknown template: ${template}` });
      return true;
    }

    try {
      const result = await dispatchEmailTemplate(template, body);
      sendJson(res, origin, 200, { success: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Email delivery failed";
      sendJson(res, origin, 500, { success: false, error: msg });
    }
    return true;
  }

  return false;
}

async function dispatchEmailTemplate(template, body) {
  switch (template) {
    case "verification":
      return sendEmailVerificationEmail({
        email: body.email,
        verificationLink: body.verificationLink,
        appPublicUrl: body.appPublicUrl,
      });

    case "password-updated":
      return sendPasswordUpdatedEmail({
        to: body.email,
        recipientName: body.recipientName,
        reason: body.reason,
      });

    case "new-sign-in-alert":
      return sendNewSignInAlertEmail({
        to: body.email,
        recipientName: body.recipientName,
        ip: body.ip,
        deviceSummary: body.deviceSummary,
        signedInAt: body.signedInAt,
      });

    case "phone-verified":
      return sendPhoneVerifiedEmail({
        to: body.email,
        recipientName: body.recipientName,
        phone: body.phone,
      });

    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
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
