import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/**
 * @param {{ to: string; recipientName?: string; reason: "changed" | "reset" }} input
 */
export async function sendPasswordUpdatedEmail(input) {
  const email = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };
  return sendEmailViaNotify("password-updated", {
    email,
    recipientName: input.recipientName,
    reason: input.reason,
  });
}

/**
 * @param {{ to: string; recipientName?: string; ip: string; deviceSummary: string; signedInAt?: string }} input
 */
export async function sendNewSignInAlertEmail(input) {
  const email = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };
  return sendEmailViaNotify("new-sign-in-alert", {
    email,
    recipientName: input.recipientName,
    ip: input.ip,
    deviceSummary: input.deviceSummary,
    signedInAt: input.signedInAt,
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} profile
 * @param {{ displayName?: string | null; email?: string | null }} [userRecord]
 */
export function resolveSecurityEmailRecipient(profile, userRecord) {
  const email =
    (typeof userRecord?.email === "string" ? userRecord.email : "") ||
    (typeof profile?.primaryEmail === "string" ? profile.primaryEmail : "");
  const first =
    (typeof profile?.firstName === "string" ? profile.firstName : "") ||
    (typeof profile?.first_name === "string" ? profile.first_name : "");
  const last =
    (typeof profile?.lastName === "string" ? profile.lastName : "") ||
    (typeof profile?.last_name === "string" ? profile.last_name : "");
  const combined = `${first} ${last}`.trim();
  const recipientName = combined || userRecord?.displayName || "there";
  return {
    to: email.trim().toLowerCase(),
    recipientName,
  };
}
