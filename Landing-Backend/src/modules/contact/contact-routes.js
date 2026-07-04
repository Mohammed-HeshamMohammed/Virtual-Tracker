import { getEnv } from "../../config/env.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { rejectUnknownFields, assertMaxLength } from "../../http/validate-body.js";
import { sendJson } from "../../http/response.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { notifyRequest } from "../../lib/notify-request.js";

const CONTACT_TOPICS = new Set(["trial", "cloud", "security", "general"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>} true if handled
 */
export async function routeContact(req, res, url, origin) {
  if (url.pathname !== "/api/contact" || req.method !== "POST") return false;

  let body;
  try {
    body = await readJsonBody(req);
    rejectUnknownFields(body, ["name", "email", "topic", "teamSize", "message"]);
  } catch (e) {
    sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" }, req);
    return true;
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const topic = typeof body.topic === "string" && CONTACT_TOPICS.has(body.topic) ? body.topic : "general";
  const teamSize = typeof body.teamSize === "string" ? body.teamSize.trim() : "";

  try {
    assertMaxLength(name, 200, "name");
    assertMaxLength(email, 320, "email");
    assertMaxLength(message, 4000, "message");
    assertMaxLength(teamSize, 40, "teamSize");
  } catch (e) {
    sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid field" }, req);
    return true;
  }

  if (!name || !email || !message) {
    sendJson(res, origin, 400, { success: false, error: "name, email, and message are required" }, req);
    return true;
  }
  if (!EMAIL_PATTERN.test(email)) {
    sendJson(res, origin, 400, { success: false, error: "A valid email address is required" }, req);
    return true;
  }

  const { backendUrl: notifyBackendUrl } = getEnv().notify;
  if (!notifyBackendUrl) {
    sendJson(res, origin, 503, { success: false, error: "The contact form is not available right now." }, req);
    return true;
  }

  // Notify-Backend is the only persistence layer for inquiries (its delivery log
  // records the submitted fields) and owns the destination inbox itself — this
  // call is required, not best-effort.
  try {
    const { response, payload } = await notifyRequest("/api/notify/email", {
      template: "contact-inquiry",
      email,
      name,
      topic,
      teamSize,
      message,
    });
    if (!response.ok || !(payload && payload.success)) {
      const upstreamError = payload && typeof payload.error === "string" ? payload.error : `status ${response.status}`;
      throw new Error(`Notify-Backend rejected the inquiry: ${upstreamError}`);
    }
  } catch (err) {
    logSafeError("[contact] notify dispatch failed", err);
    sendJson(res, origin, 500, { success: false, error: "Could not submit your message. Please try again." }, req);
    return true;
  }

  sendJson(res, origin, 201, { success: true }, req);
  return true;
}
