import crypto from "node:crypto";
import { escapeHtml, sendTransactionalEmail } from "../auth/transactional-email.js";
import { resolveAppPublicUrl } from "../auth/app-public-url.js";

/**
 * @param {{ email: string; transferUrl: string; requesterName?: string }} input
 */
function buildTransferInviteEmail(input) {
  const requesterLine = input.requesterName
    ? `${input.requesterName} has invited you to join their team on Virtual Tracker.`
    : "You have been invited to join a team on Virtual Tracker.";
  const subject = "Team membership invitation — Virtual Tracker";
  const text = [
    "Hello,",
    "",
    requesterLine,
    "",
    "Open the link below to review and accept the invitation:",
    input.transferUrl,
    "",
    "This link is single-use and will expire automatically.",
    "If you did not expect this invitation, you can decline or ignore this email.",
  ].join("\n");

  const html = `
    <p>Hello,</p>
    <p>${escapeHtml(requesterLine)}</p>
    <p><a href="${escapeHtml(input.transferUrl)}">Review invitation</a></p>
    <p>If the button does not work, copy this link into your browser:</p>
    <p><code>${escapeHtml(input.transferUrl)}</code></p>
    <p><em>This link is single-use and will expire automatically.</em></p>
    <p>If you did not expect this invitation, you can decline or ignore this email.</p>
  `.trim();

  return { subject, text, html };
}

/**
 * @param {{ email: string; transferUrl: string; requesterName?: string }} input
 */
export async function sendMemberTransferEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const transferUrl = typeof input.transferUrl === "string" ? input.transferUrl.trim() : "";
  if (!email || !transferUrl) return { sent: false, channel: "skipped" };

  const { subject, text, html } = buildTransferInviteEmail(input);
  return sendTransactionalEmail({
    to: email,
    subject,
    text,
    html,
    logPrefix: "[transfer-email]",
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
