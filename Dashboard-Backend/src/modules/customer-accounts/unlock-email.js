import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/** Mirrors verification-email.js's shape for the ordinary email-verification
 *  flow - same one-hop wrapper around Notify-backend, different template. */
export async function sendUnlockCodeEmail({ email, code, expiresInMinutes }) {
  const to = typeof email === "string" ? email.trim().toLowerCase() : "";
  const value = typeof code === "string" ? code.trim() : "";
  if (!to || !value) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("customer-accounts-unlock-code", {
    email: to,
    code: value,
    expiresInMinutes,
  });
}
