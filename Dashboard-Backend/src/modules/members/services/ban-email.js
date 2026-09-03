import { sendEmailViaNotify } from "../../../lib/notify/email-client.js";

export async function sendMemberBanEmail(input) {
  const email = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("member-ban", {
    email,
    memberName: input.memberName,
    reason: input.reason,
  });
}
