import { resolveAppPublicUrl } from "./app-public-url.js";
import { escapeHtml, sendTransactionalEmail } from "./transactional-email.js";
import { buildAuthBrandedEmailHtml } from "./auth-email-template.js";

/**
 * @param {{ email: string; displayName: string; temporaryPassword: string; signInUrl: string }} input
 */
function buildPreprovisionWelcomeEmail(input) {
  const greetingName = input.displayName?.trim() || "";
  const subject = "Your Virtual Tracker account is ready";
  const text = [
    `Hello${greetingName ? ` ${greetingName}` : ""},`,
    "",
    "An administrator created a Virtual Tracker account for you.",
    "",
    `Email: ${input.email}`,
    `Temporary password: ${input.temporaryPassword}`,
    "",
    "Sign in using the link below, then you will be required to choose a new password immediately.",
    "You cannot access the application until your password has been changed.",
    "",
    `Sign in: ${input.signInUrl}`,
    "",
    "If you did not expect this email, contact your administrator.",
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Your Virtual Tracker account is ready",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello${greetingName ? ` ${escapeHtml(greetingName)}` : ""},</p>
      <p style="margin:0 0 12px;">An administrator created a <strong>Virtual Tracker</strong> account for you.</p>
      <div style="margin:16px 0;padding:16px 18px;border-radius:12px;background:#f8fafc;border:1px solid rgba(203,195,215,0.45);">
        <p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#334155;">
          <strong>Email:</strong> ${escapeHtml(input.email)}
        </p>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#334155;">
          <strong>Temporary password:</strong>
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;color:#171c1f;">${escapeHtml(input.temporaryPassword)}</span>
        </p>
      </div>
      <p style="margin:0;">Sign in and you will be required to <strong>change your password immediately</strong>. Application access is blocked until your password is updated.</p>
    `.trim(),
    actionLabel: "Sign in to Virtual Tracker",
    actionHref: input.signInUrl,
    footerHtml: `
      <p style="margin:0;">If you did not expect this email, contact your administrator.</p>
    `.trim(),
  });

  return { subject, text, html };
}

/**
 * Sends pre-provision welcome email via Resend when configured; otherwise logs (dev/demo).
 * Temporary password is never persisted — only passed through this call.
 *
 * @param {{ email: string; displayName: string; temporaryPassword: string }} input
 * @returns {Promise<{ sent: boolean; channel: string }>}
 */
export async function sendPreprovisionWelcomeEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };

  const signInUrl = resolveAppPublicUrl();
  const { subject, text, html } = buildPreprovisionWelcomeEmail({
    email,
    displayName: input.displayName,
    temporaryPassword: input.temporaryPassword,
    signInUrl,
  });

  return sendTransactionalEmail({
    to: email,
    subject,
    text,
    html,
    logPrefix: "[preprovision-email]",
  });
}
