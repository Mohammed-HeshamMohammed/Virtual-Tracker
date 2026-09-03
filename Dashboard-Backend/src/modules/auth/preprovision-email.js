import { resolveAppPublicUrl } from "./app-public-url.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

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
