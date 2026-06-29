import crypto from "node:crypto";
import { sendEmailViaNotify } from "../../lib/notify/email-client.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";

/**
 * @param {{ email: string; transferUrl: string; requesterName?: string }} input
 */
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

/**
 * @param {string} token
 * @param {string | undefined} appOrigin
 */
export function buildTransferRequestUrl(token, appOrigin) {
  return `${resolveAppPublicUrl(appOrigin)}/transfer/${token}`;
}

/**
 * @returns {string}
 */
export function generateTransferToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Default expiry: 7 days
 * @returns {Date}
 */
export function defaultTransferExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}
