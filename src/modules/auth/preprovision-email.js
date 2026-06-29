import { resolveAppPublicUrl } from "./app-public-url.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/**
 * Sends pre-provision welcome email via Notify-Backend.
 * Temporary password is never persisted — only passed through this call.
 *
 * @param {{ email: string; displayName: string; temporaryPassword: string }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendPreprovisionWelcomeEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("preprovision-welcome", {
    email,
    displayName: input.displayName,
    temporaryPassword: input.temporaryPassword,
    signInUrl: resolveAppPublicUrl(),
  });
}
