/**
 * Calls Notify-Backend for templated transactional email delivery.
 * Dashboard-Backend must not send email directly (no SMTP/Resend credentials here).
 */
import { getEnv } from "../../config/env.js";
import { notifyRequest } from "./notify-request.js";

/** Whether Dashboard is configured to route outbound email through Notify-Backend. */
export function isNotifyEmailRoutingConfigured() {
  return Boolean(getEnv().notify.backendUrl?.trim());
}

/**
 * @param {string} template
 * @param {Record<string, unknown>} data
 * @returns {Promise<{ sent: boolean; channel: string; error?: string }>}
 */
export async function sendEmailViaNotify(template, data) {
  const key = typeof template === "string" ? template.trim() : "";
  if (!key) return { sent: false, channel: "skipped" };

  let response;
  let payload;
  try {
    ({ response, payload } = await notifyRequest("/api/notify/email", { template: key, ...data }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email delivery is temporarily unavailable.";
    return { sent: false, channel: "notify_unavailable", error: message };
  }

  if (!response.ok || payload?.success !== true) {
    const message =
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : "Email delivery failed.";
    return {
      sent: false,
      channel: typeof payload?.channel === "string" ? payload.channel : "notify_failed",
      error: message,
    };
  }

  return {
    sent: payload.sent === true,
    channel: typeof payload.channel === "string" ? payload.channel : "notify",
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}
