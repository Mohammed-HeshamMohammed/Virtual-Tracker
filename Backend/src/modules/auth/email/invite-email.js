import { escapeHtml, sendTransactionalEmail } from "./transactional-email.js";
import { buildAuthBrandedEmailHtml } from "./auth-email-template.js";

/**
 * @param {{ email: string; inviteUrl: string; roleName?: string }} input
 */
function buildMemberInviteEmail(input) {
  const roleLine = input.roleName ? `Role: ${input.roleName}` : "";
  const subject = "You're invited to Virtual Tracker";
  const text = [
    "Hello,",
    "",
    "You've been invited to join Virtual Tracker.",
    roleLine,
    "",
    "Open the link below to create your account and complete registration:",
    input.inviteUrl,
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ]
    .filter(Boolean)
    .join("\n");

  const roleBodyHtml = input.roleName
    ? `<p style="margin:0 0 12px;">You've been invited to join <strong>Virtual Tracker</strong> as <strong>${escapeHtml(input.roleName)}</strong>.</p>`
    : `<p style="margin:0 0 12px;">You've been invited to join <strong>Virtual Tracker</strong>.</p>`;

  const html = buildAuthBrandedEmailHtml({
    title: "You're invited",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello,</p>
      ${roleBodyHtml}
      <p style="margin:0;">Tap the button below to create your account and complete registration.</p>
    `.trim(),
    actionLabel: "Accept invitation and create your account",
    actionHref: input.inviteUrl,
    footerHtml: `
      <p style="margin:0 0 12px;">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0;word-break:break-all;"><a href="${escapeHtml(input.inviteUrl)}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(input.inviteUrl)}</a></p>
      <p style="margin:16px 0 0;">If you did not expect this invitation, you can ignore this email.</p>
    `.trim(),
  });

  return { subject, text, html };
}

/**
 * @param {{ email: string; inviteUrl: string; roleName?: string }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendMemberInviteEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const inviteUrl = typeof input.inviteUrl === "string" ? input.inviteUrl.trim() : "";
  if (!email || !inviteUrl) return { sent: false, channel: "skipped" };

  const { subject, text, html } = buildMemberInviteEmail({
    email,
    inviteUrl,
    roleName: input.roleName,
  });

  return sendTransactionalEmail({
    to: email,
    subject,
    text,
    html,
    logPrefix: "[invite-email]",
  });
}
