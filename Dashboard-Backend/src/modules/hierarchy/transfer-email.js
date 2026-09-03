import crypto from "node:crypto";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";

export async function sendMemberTransferEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const transferUrl = typeof input.transferUrl === "string" ? input.transferUrl.trim() : "";
  if (!email || !transferUrl) return { sent: false, channel: "skipped" };

  return sendEmailViaNotify("transfer-invite", {
    email,
    transferUrl,
    requesterName: input.requesterName,
  });
}

export function buildTransferRequestUrl(token, appOrigin) {
  return `${resolveAppPublicUrl(appOrigin)}/transfer/${token}`;
}

export function generateTransferToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function defaultTransferExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}
