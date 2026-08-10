import { sendEmailViaNotify } from "../../lib/notify/email-client.js";

/**
 * @param {{ email: string; inviteUrl: string; roleName?: string }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendMemberInviteEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const inviteUrl = typeof input.inviteUrl === "string" ? input.inviteUrl.trim() : "";
  if (!email || !inviteUrl) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("member-invite", {
    email,
    inviteUrl,
    roleName: input.roleName,
  });
}
