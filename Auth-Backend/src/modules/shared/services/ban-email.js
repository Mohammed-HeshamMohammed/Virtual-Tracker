import { getEnv } from "../../../config/env/index.js";
import { escapeHtml, sendTransactionalEmail } from "../../auth/email/transactional-email.js";

import { getEmailDeliveryConfig } from "../../auth/email/email-config.js";

const DEFAULT_SUPPORT_EMAIL = "support@virtualtracker.com";

/**
 * Use the same outbound mailbox as transactional email (from address or SMTP user).
 */
function resolveSupportContactEmail() {
  const { email } = getEnv();
  const delivery = getEmailDeliveryConfig();
  const from = delivery.from || email.resendFrom || email.smtpFrom || "";
  const angleMatch = from.match(/<([^>]+@[^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  if (typeof from === "string" && from.includes("@")) return from.trim().toLowerCase();
  if (email.smtpUser?.includes("@")) return email.smtpUser.trim().toLowerCase();
  if (email.supportEmail?.trim()) return email.supportEmail.trim().toLowerCase();
  return DEFAULT_SUPPORT_EMAIL;
}
/**
 * @param {{ memberName: string; reason: string }} input
 */
function buildBanNotificationEmail(input) {
  const supportEmail = resolveSupportContactEmail();
  const subject = "Your Virtual Tracker access has been restricted";
  const text = [
    `Hello ${input.memberName || "there"},`,
    "",
    "Your access to Virtual Tracker has been restricted by an administrator.",
    "",
    `Reason: ${input.reason}`,
    "",
    "If you believe this was a mistake, please contact our support team:",
    supportEmail,
    "",
    "This is an automated notification. Please do not reply to this email — replies are not monitored.",
  ].join("\n");

  const html = `
    <p>Hello ${escapeHtml(input.memberName || "there")},</p>
    <p>Your access to <strong>Virtual Tracker</strong> has been restricted by an administrator.</p>
    <p><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>
    <p>If you believe this was a mistake, please contact our support team at
      <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
    <p style="color:#64748b;font-size:13px;margin-top:24px;">
      This is an automated notification. Please do not reply to this email — replies are not monitored.
    </p>
  `.trim();

  return { subject, text, html };
}

/**
 * @param {{ to: string; memberName: string; reason: string }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendMemberBanEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };

  const { subject, text, html } = buildBanNotificationEmail({
    memberName: input.memberName,
    reason: input.reason,
  });

  return sendTransactionalEmail({
    to,
    subject,
    text,
    html,
    logPrefix: "[ban-email]",
  });
}
