import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/**
 * @param {{ to: string; memberName: string; reason: string }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendMemberBanEmail(input) {
  const email = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("member-ban", {
    email,
    memberName: input.memberName,
    reason: input.reason,
  });
}
