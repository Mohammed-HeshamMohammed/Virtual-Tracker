import { resolveAppPublicUrl } from "./app-public-url.js";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/**
 * Nudge email for a member stuck on the "Team onboarding" checklist -
 * download the desktop agent or start tracking time.
 * @param {{ email: string; displayName?: string; step: "download_app" | "track_time" }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendOnboardingReminderEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("onboarding-reminder", {
    email,
    displayName: input.displayName,
    step: input.step,
    appUrl: resolveAppPublicUrl(),
  });
}
