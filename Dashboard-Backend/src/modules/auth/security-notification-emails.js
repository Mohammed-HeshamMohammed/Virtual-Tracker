import { getEnv } from "../../config/env.js";
import { escapeHtml, sendTransactionalEmail } from "./transactional-email.js";
import { buildAuthBrandedEmailHtml } from "./auth-email-template.js";
import { getEmailDeliveryConfig } from "./email-config.js";

const DEFAULT_SUPPORT_EMAIL = "support@virtualtracker.com";

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

function resolveAppSignInUrl() {
  const { urls } = getEnv();
  const base = (urls.appPublicUrl || urls.frontendOrigin || "http://localhost:3000").replace(/\/+$/, "");
  return base;
}

function formatWhen(iso = new Date().toISOString()) {
  try {
    return (
      new Date(iso).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    );
  } catch {
    return iso;
  }
}

/**
 * @param {{ recipientName?: string; phone: string }} input
 */
export function buildPhoneVerifiedEmail(input) {
  const name = input.recipientName?.trim() || "there";
  const phone = input.phone?.trim() || "";
  const subject = "Your phone number was verified — Virtual Tracker";
  const text = [
    `Hello ${name},`,
    "",
    "This confirms your phone number was successfully verified on your Virtual Tracker account.",
    phone ? `Phone number: ${phone}` : "",
    "",
    "If you did not verify this number, contact support immediately.",
    resolveSupportContactEmail(),
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Phone number verified",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">Your phone number was successfully verified on your <strong>Virtual Tracker</strong> account.</p>
      ${
        phone
          ? `<p style="margin:0 0 12px;"><strong>Phone:</strong> ${escapeHtml(phone)}</p>`
          : ""
      }
      <p style="margin:0;">If you did not verify this number, contact support immediately.</p>
    `.trim(),
    actionLabel: "Open Virtual Tracker",
    actionHref: resolveAppSignInUrl(),
    footerHtml: `
      <p style="margin:0;">Support: <a href="mailto:${escapeHtml(resolveSupportContactEmail())}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(resolveSupportContactEmail())}</a></p>
    `.trim(),
  });

  return { subject, text, html };
}

/**
 * @param {{ recipientName?: string; reason: "changed" | "reset" }} input
 */
export function buildPasswordUpdatedEmail(input) {
  const name = input.recipientName?.trim() || "there";
  const isReset = input.reason === "reset";
  const subject = isReset
    ? "Your Virtual Tracker password was reset"
    : "Your Virtual Tracker password was changed";
  const action = isReset ? "reset" : "changed";
  const text = [
    `Hello ${name},`,
    "",
    `Your Virtual Tracker account password was ${action} successfully.`,
    "",
    "If you did not make this change, reset your password immediately and contact support.",
    resolveSupportContactEmail(),
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: isReset ? "Password reset" : "Password changed",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">Your Virtual Tracker account password was <strong>${escapeHtml(action)}</strong> successfully.</p>
      <p style="margin:0;">If you did not make this change, reset your password immediately and contact support.</p>
    `.trim(),
    actionLabel: "Sign in",
    actionHref: resolveAppSignInUrl(),
    footerHtml: `
      <p style="margin:0;">Support: <a href="mailto:${escapeHtml(resolveSupportContactEmail())}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(resolveSupportContactEmail())}</a></p>
    `.trim(),
  });

  return { subject, text, html };
}

/**
 * @param {{ recipientName?: string; ip: string; deviceSummary: string; signedInAt?: string }} input
 */
export function buildNewSignInAlertEmail(input) {
  const name = input.recipientName?.trim() || "there";
  const ip = input.ip?.trim() || "Unknown";
  const device = input.deviceSummary?.trim() || "Unknown device";
  const when = formatWhen(input.signedInAt);
  const subject = "New sign-in to your Virtual Tracker account";
  const text = [
    `Hello ${name},`,
    "",
    "We noticed a sign-in to your Virtual Tracker account from a new location or device.",
    "",
    `When: ${when}`,
    `Device: ${device}`,
    `IP address: ${ip}`,
    "",
    "If this was you, you can ignore this email.",
    "If you do not recognize this activity, change your password immediately and contact support.",
    resolveSupportContactEmail(),
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "New sign-in detected",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">We noticed a sign-in to your <strong>Virtual Tracker</strong> account from a new location or device.</p>
      <table role="presentation" style="margin:12px 0 16px;width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#64748b;width:96px;">When</td><td style="padding:4px 0;color:#171c1f;">${escapeHtml(when)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Device</td><td style="padding:4px 0;color:#171c1f;">${escapeHtml(device)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">IP address</td><td style="padding:4px 0;color:#171c1f;">${escapeHtml(ip)}</td></tr>
      </table>
      <p style="margin:0;">If this was you, you can ignore this email. If you do not recognize this activity, change your password immediately.</p>
    `.trim(),
    actionLabel: "Review account",
    actionHref: resolveAppSignInUrl(),
    footerHtml: `
      <p style="margin:0;">Support: <a href="mailto:${escapeHtml(resolveSupportContactEmail())}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(resolveSupportContactEmail())}</a></p>
    `.trim(),
  });

  return { subject, text, html };
}

/**
 * @param {{ to: string; recipientName?: string; phone: string }} input
 */
export async function sendPhoneVerifiedEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };
  const { subject, text, html } = buildPhoneVerifiedEmail(input);
  return sendTransactionalEmail({ to, subject, text, html, logPrefix: "[phone-verified-email]" });
}

/**
 * @param {{ to: string; recipientName?: string; reason: "changed" | "reset" }} input
 */
export async function sendPasswordUpdatedEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };
  const { subject, text, html } = buildPasswordUpdatedEmail(input);
  return sendTransactionalEmail({ to, subject, text, html, logPrefix: "[password-updated-email]" });
}

/**
 * @param {{ to: string; recipientName?: string; ip: string; deviceSummary: string; signedInAt?: string }} input
 */
export async function sendNewSignInAlertEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };
  const { subject, text, html } = buildNewSignInAlertEmail(input);
  return sendTransactionalEmail({ to, subject, text, html, logPrefix: "[new-sign-in-email]" });
}

/**
 * @param {Record<string, unknown> | null | undefined} profile
 * @param {{ displayName?: string | null; email?: string | null }} [userRecord]
 */
export function resolveSecurityEmailRecipient(profile, userRecord) {
  const email =
    (typeof userRecord?.email === "string" ? userRecord.email : "") ||
    (typeof profile?.primaryEmail === "string" ? profile.primaryEmail : "");
  const first =
    (typeof profile?.firstName === "string" ? profile.firstName : "") ||
    (typeof profile?.first_name === "string" ? profile.first_name : "");
  const last =
    (typeof profile?.lastName === "string" ? profile.lastName : "") ||
    (typeof profile?.last_name === "string" ? profile.last_name : "");
  const combined = `${first} ${last}`.trim();
  const recipientName = combined || userRecord?.displayName || "there";
  return {
    to: email.trim().toLowerCase(),
    recipientName,
  };
}
