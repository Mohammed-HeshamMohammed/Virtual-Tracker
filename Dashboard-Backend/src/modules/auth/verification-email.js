import { escapeHtml, sendTransactionalEmail } from "./transactional-email.js";
import { buildAuthBrandedEmailHtml, rewriteFirebaseActionLinkToAppHandler } from "./auth-email-template.js";

/**
 * @param {{ email: string; verificationLink: string; appPublicUrl?: string }} input
 */
export function buildEmailVerificationEmail(input) {
  const appPublicUrl = typeof input.appPublicUrl === "string" ? input.appPublicUrl.trim() : "";
  const verificationLink = appPublicUrl
    ? rewriteFirebaseActionLinkToAppHandler(input.verificationLink, appPublicUrl)
    : input.verificationLink;

  const subject = "Verify your email — Virtual Tracker";
  const text = [
    "Hello,",
    "",
    "Please verify your email address to finish setting up your Virtual Tracker account.",
    "",
    "Open the link below to verify your email:",
    verificationLink,
    "",
    "If you did not create this account, you can ignore this email.",
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Verify your email",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 12px;">Please verify your email address to finish setting up your <strong>Virtual Tracker</strong> account.</p>
      <p style="margin:0;">Tap the button below to confirm your email and return to sign in.</p>
    `.trim(),
    actionLabel: "Verify my email",
    actionHref: verificationLink,
    footerHtml: `
      <p style="margin:0 0 12px;">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0;word-break:break-all;"><a href="${escapeHtml(verificationLink)}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(verificationLink)}</a></p>
      <p style="margin:16px 0 0;">If you did not create this account, you can ignore this email.</p>
    `.trim(),
  });

  return { subject, text, html, verificationLink };
}

/**
 * @param {{ email: string; verificationLink: string; appPublicUrl?: string }} input
 * @returns {Promise<{ sent: boolean; channel: string; error?: string }>}
 */
export async function sendEmailVerificationEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const verificationLink =
    typeof input.verificationLink === "string" ? input.verificationLink.trim() : "";
  if (!email || !verificationLink) return { sent: false, channel: "skipped" };

  const { subject, text, html } = buildEmailVerificationEmail({
    email,
    verificationLink,
    appPublicUrl: input.appPublicUrl,
  });

  return sendTransactionalEmail({
    to: email,
    subject,
    text,
    html,
    logPrefix: "[verification-email]",
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} body
 * @param {{ urls: { appPublicUrl: string; frontendOrigin: string } }} env
 */
export function resolveAuthContinueUrl(body, env) {
  const fromBody = typeof body?.continueUrl === "string" ? body.continueUrl.trim() : "";
  if (fromBody) {
    try {
      const parsed = new URL(fromBody);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return fromBody.replace(/\/$/, "");
      }
    } catch {
      // Fall through to configured defaults.
    }
  }

  const configured = (env.urls.appPublicUrl || env.urls.frontendOrigin || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return "http://localhost:3000";
}

/**
 * @param {string} continueUrl
 */
export function withEmailVerifiedContinueUrl(continueUrl) {
  try {
    const url = new URL(continueUrl);
    url.searchParams.set("emailVerified", "1");
    return url.toString();
  } catch {
    return `${continueUrl.replace(/\/$/, "")}/?emailVerified=1`;
  }
}
