/**
 * Email builders — verification, security notifications.
 * Ported from Dashboard-Backend verification-email.js + security-notification-emails.js.
 */
import { escapeHtml, sendTransactionalEmail } from "./transactional-email.js";
import { buildAuthBrandedEmailHtml, rewriteFirebaseActionLinkToAppHandler } from "./email-template.js";
import { getEmailDeliveryConfig } from "./email-config.js";
import { getEnv } from "../../config/env.js";

const DEFAULT_SUPPORT_EMAIL = "support@myvirtualtracker.com";

function resolveSupportContactEmail() {
  const delivery = getEmailDeliveryConfig();
  const { email } = getEnv();
  const from = delivery.from || email.resendFrom || email.smtpFrom || "";
  const angleMatch = from.match(/<([^>]+@[^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  if (typeof from === "string" && from.includes("@")) return from.trim().toLowerCase();
  if (email.smtpUser?.includes("@")) return email.smtpUser.trim().toLowerCase();
  return DEFAULT_SUPPORT_EMAIL;
}

function formatWhen(iso = new Date().toISOString()) {
  try {
    return (
      new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) +
      " UTC"
    );
  } catch {
    return iso;
  }
}

// ── Verification email ────────────────────────────────────────────────────────

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
 */
export async function sendEmailVerificationEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const verificationLink = typeof input.verificationLink === "string" ? input.verificationLink.trim() : "";
  if (!email || !verificationLink) return { sent: false, channel: "skipped" };

  const { subject, text, html } = buildEmailVerificationEmail({ email, verificationLink, appPublicUrl: input.appPublicUrl });
  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[verification-email]" });
}

// ── Security notification emails ──────────────────────────────────────────────

/** @param {{ recipientName?: string; reason: "changed" | "reset" }} input */
export function buildPasswordUpdatedEmail(input) {
  const name = input.recipientName?.trim() || "there";
  const isReset = input.reason === "reset";
  const subject = isReset ? "Your Virtual Tracker password was reset" : "Your Virtual Tracker password was changed";
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
    actionHref: (getEnv().cors.frontendOrigin || "https://app.myvirtualtracker.com"),
    footerHtml: `<p style="margin:0;">Support: <a href="mailto:${escapeHtml(resolveSupportContactEmail())}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(resolveSupportContactEmail())}</a></p>`,
  });

  return { subject, text, html };
}

/** @param {{ recipientName?: string; ip: string; deviceSummary: string; signedInAt?: string }} input */
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
    actionHref: (getEnv().cors.frontendOrigin || "https://app.myvirtualtracker.com"),
    footerHtml: `<p style="margin:0;">Support: <a href="mailto:${escapeHtml(resolveSupportContactEmail())}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(resolveSupportContactEmail())}</a></p>`,
  });

  return { subject, text, html };
}

/** @param {{ to: string; recipientName?: string; reason: "changed" | "reset" }} input */
export async function sendPasswordUpdatedEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };
  const { subject, text, html } = buildPasswordUpdatedEmail(input);
  return sendTransactionalEmail({ to, subject, text, html, logPrefix: "[password-updated-email]" });
}

/** @param {{ to: string; recipientName?: string; ip: string; deviceSummary: string; signedInAt?: string }} input */
export async function sendNewSignInAlertEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };
  const { subject, text, html } = buildNewSignInAlertEmail(input);
  return sendTransactionalEmail({ to, subject, text, html, logPrefix: "[new-sign-in-email]" });
}

/**
 * Resolve email + display name from a Firestore profile + Firebase user record.
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
  return { to: email.trim().toLowerCase(), recipientName };
}

// ── Member invite ─────────────────────────────────────────────────────────────

/** @param {{ email: string; inviteUrl: string; roleName?: string }} input */
export async function sendMemberInviteEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const inviteUrl = typeof input.inviteUrl === "string" ? input.inviteUrl.trim() : "";
  if (!email || !inviteUrl) return { sent: false, channel: "skipped" };

  const roleName = typeof input.roleName === "string" ? input.roleName.trim() : "";
  const roleLine = roleName ? `Role: ${roleName}` : "";
  const subject = "You're invited to Virtual Tracker";
  const text = [
    "Hello,",
    "",
    "You've been invited to join Virtual Tracker.",
    roleLine,
    "",
    "Open the link below to create your account and complete registration:",
    inviteUrl,
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ]
    .filter(Boolean)
    .join("\n");

  const roleBodyHtml = roleName
    ? `<p style="margin:0 0 12px;">You've been invited to join <strong>Virtual Tracker</strong> as <strong>${escapeHtml(roleName)}</strong>.</p>`
    : `<p style="margin:0 0 12px;">You've been invited to join <strong>Virtual Tracker</strong>.</p>`;

  const html = buildAuthBrandedEmailHtml({
    title: "You're invited",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello,</p>
      ${roleBodyHtml}
      <p style="margin:0;">Tap the button below to create your account and complete registration.</p>
    `.trim(),
    actionLabel: "Accept invitation and create your account",
    actionHref: inviteUrl,
    footerHtml: `
      <p style="margin:0 0 12px;">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0;word-break:break-all;"><a href="${escapeHtml(inviteUrl)}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(inviteUrl)}</a></p>
      <p style="margin:16px 0 0;">If you did not expect this invitation, you can ignore this email.</p>
    `.trim(),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[invite-email]" });
}

// ── Pre-provision welcome ─────────────────────────────────────────────────────

/** @param {{ email: string; displayName?: string; temporaryPassword: string; signInUrl: string }} input */
export async function sendPreprovisionWelcomeEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const temporaryPassword = typeof input.temporaryPassword === "string" ? input.temporaryPassword : "";
  const signInUrl = typeof input.signInUrl === "string" ? input.signInUrl.trim() : "";
  if (!email || !temporaryPassword || !signInUrl) return { sent: false, channel: "skipped" };

  const greetingName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const subject = "Your Virtual Tracker account is ready";
  const text = [
    `Hello${greetingName ? ` ${greetingName}` : ""},`,
    "",
    "An administrator created a Virtual Tracker account for you.",
    "",
    `Email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "Sign in using the link below, then you will be required to choose a new password immediately.",
    signInUrl,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Your Virtual Tracker account is ready",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello${greetingName ? ` ${escapeHtml(greetingName)}` : ""},</p>
      <p style="margin:0 0 12px;">An administrator created a <strong>Virtual Tracker</strong> account for you.</p>
      <div style="margin:16px 0;padding:16px 18px;border-radius:12px;background:#f8fafc;border:1px solid rgba(203,195,215,0.45);">
        <p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#334155;"><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#334155;"><strong>Temporary password:</strong>
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;color:#171c1f;">${escapeHtml(temporaryPassword)}</span>
        </p>
      </div>
      <p style="margin:0;">Sign in and you will be required to <strong>change your password immediately</strong>.</p>
    `.trim(),
    actionLabel: "Sign in to Virtual Tracker",
    actionHref: signInUrl,
    footerHtml: `<p style="margin:0;">If you did not expect this email, contact your administrator.</p>`,
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[preprovision-email]" });
}

// ── Registration welcome ──────────────────────────────────────────────────────

/** @param {{ email: string; displayName?: string; signInUrl: string }} input */
export async function sendRegistrationWelcomeEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const signInUrl = typeof input.signInUrl === "string" ? input.signInUrl.trim() : "";
  if (!email || !signInUrl) return { sent: false, channel: "skipped" };

  const name = typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim() : "there";
  const subject = "Welcome to Virtual Tracker";
  const text = [
    `Hello ${name},`,
    "",
    "Your email is verified and your Virtual Tracker account is ready.",
    "",
    `Sign in: ${signInUrl}`,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Welcome to Virtual Tracker",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 12px;">Your email is verified and your <strong>Virtual Tracker</strong> account is ready.</p>
      <p style="margin:0 0 12px;">Sign in to access your dashboard and update your profile.</p>
    `.trim(),
    actionLabel: "Sign in to Virtual Tracker",
    actionHref: signInUrl,
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[registration-welcome-email]" });
}

// ── Team transfer invite ──────────────────────────────────────────────────────

/** @param {{ email: string; transferUrl: string; requesterName?: string }} input */
export async function sendMemberTransferEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const transferUrl = typeof input.transferUrl === "string" ? input.transferUrl.trim() : "";
  if (!email || !transferUrl) return { sent: false, channel: "skipped" };

  const requesterLine = input.requesterName?.trim()
    ? `${input.requesterName.trim()} has invited you to join their team on Virtual Tracker.`
    : "You have been invited to join a team on Virtual Tracker.";
  const subject = "Team membership invitation — Virtual Tracker";
  const text = [
    "Hello,",
    "",
    requesterLine,
    "",
    "Open the link below to review and accept the invitation:",
    transferUrl,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Team invitation",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 12px;">${escapeHtml(requesterLine)}</p>
      <p style="margin:0;">Tap the button below to review and accept the invitation.</p>
    `.trim(),
    actionLabel: "Review invitation",
    actionHref: transferUrl,
    footerHtml: `
      <p style="margin:0 0 12px;">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0;word-break:break-all;"><a href="${escapeHtml(transferUrl)}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(transferUrl)}</a></p>
      <p style="margin:16px 0 0;"><em>This link is single-use and will expire automatically.</em></p>
    `.trim(),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[transfer-email]" });
}

// ── Member ban notification ───────────────────────────────────────────────────

/** @param {{ email: string; memberName?: string; reason: string }} input */
export async function sendMemberBanEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!email || !reason) return { sent: false, channel: "skipped" };

  const memberName = typeof input.memberName === "string" && input.memberName.trim() ? input.memberName.trim() : "there";
  const supportEmail = resolveSupportContactEmail();
  const subject = "Your Virtual Tracker access has been restricted";
  const text = [
    `Hello ${memberName},`,
    "",
    "Your access to Virtual Tracker has been restricted by an administrator.",
    "",
    `Reason: ${reason}`,
    "",
    `Support: ${supportEmail}`,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "Access restricted",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hello ${escapeHtml(memberName)},</p>
      <p style="margin:0 0 12px;">Your access to <strong>Virtual Tracker</strong> has been restricted by an administrator.</p>
      <p style="margin:0 0 12px;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      <p style="margin:0;">If you believe this was a mistake, please contact our support team.</p>
    `.trim(),
    footerHtml: `
      <p style="margin:0;">Support: <a href="mailto:${escapeHtml(supportEmail)}" style="color:#6b38d4;text-decoration:none;">${escapeHtml(supportEmail)}</a></p>
      <p style="margin:16px 0 0;color:#64748b;font-size:13px;">This is an automated notification. Please do not reply to this email.</p>
    `.trim(),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[ban-email]" });
}

// ── Team weekly report ────────────────────────────────────────────────────────

/** @param {{ email: string; teamName: string; memberCount: number; appUrl: string }} input */
export async function sendTeamWeeklyReportEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const teamName = typeof input.teamName === "string" ? input.teamName.trim() : "Team";
  const appUrl = typeof input.appUrl === "string" ? input.appUrl.trim() : "";
  const memberCount = Number.isFinite(input.memberCount) ? input.memberCount : 0;
  if (!email || !appUrl) return { sent: false, channel: "skipped" };

  const subject = `Weekly team report — ${teamName}`;
  const text = `Weekly report for ${teamName}\n\nMembers on team: ${memberCount}\n\nOpen your dashboard: ${appUrl}\n`;
  const html = buildAuthBrandedEmailHtml({
    title: `Weekly report — ${teamName}`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Weekly report for <strong>${escapeHtml(teamName)}</strong></p>
      <p style="margin:0 0 12px;">Members on team: <strong>${memberCount}</strong></p>
    `.trim(),
    actionLabel: "Open your dashboard",
    actionHref: appUrl,
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[team-weekly-report]" });
}
