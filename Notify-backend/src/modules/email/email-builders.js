// Template builders for POST /api/notify/email.
import { escapeHtml, sendTransactionalEmail } from "./transactional-email.js";
import {
  buildAuthBrandedEmailHtml,
  calloutHtml,
  credentialPanelHtml,
  detailTableHtml,
  linkFallbackHtml,
  rewriteFirebaseActionLinkToAppHandler,
  stepsListHtml,
  supportFooterHtml,
} from "./email-template.js";
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

function appSignInUrl() {
  return getEnv().cors.frontendOrigin || "https://app.myvirtualtracker.com";
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

function greeting(name, fallback = "there") {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || fallback;
}

// ── Verification email ────────────────────────────────────────────────────────

/** @param {{ email: string; verificationLink: string; appPublicUrl?: string }} input */
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
    title: "Verify your email address",
    subtitle: "One quick step to secure your account",
    badge: "Account setup",
    badgeVariant: "welcome",
    preheader: "Confirm your email to activate your Virtual Tracker account.",
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello,</p>
      <p style="margin:0 0 14px;">Thanks for joining <strong>Virtual Tracker</strong>. Verifying your email helps us protect your account and ensures you receive important security alerts.</p>
      ${stepsListHtml([
        "Click <strong>Verify my email</strong> below.",
        "You'll return to Virtual Tracker automatically.",
        "Sign in and complete your profile setup.",
      ])}
      ${calloutHtml(
        "info",
        "Didn't sign up?",
        "<p style=\"margin:0;\">If you didn't create a Virtual Tracker account, you can safely ignore this email — no action is required.</p>",
      )}
    `.trim(),
    actionLabel: "Verify my email",
    actionHref: verificationLink,
    footerHtml: linkFallbackHtml(verificationLink),
  });

  return { subject, text, html, verificationLink };
}

/** @param {{ email: string; verificationLink: string; appPublicUrl?: string }} input */
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
  const name = greeting(input.recipientName);
  const isReset = input.reason === "reset";
  const action = isReset ? "reset" : "changed";
  const supportEmail = resolveSupportContactEmail();
  const subject = isReset ? "Your Virtual Tracker password was reset" : "Your Virtual Tracker password was changed";
  const text = [
    `Hello ${name},`,
    "",
    `Your Virtual Tracker account password was ${action} successfully.`,
    "",
    "If you did not make this change, reset your password immediately and contact support.",
    supportEmail,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: isReset ? "Password successfully reset" : "Password successfully changed",
    subtitle: "Your account credentials were updated",
    badge: "Security",
    badgeVariant: "security",
    preheader: `Your Virtual Tracker password was ${action}. If this wasn't you, act immediately.`,
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 14px;">This confirms that the password for your <strong>Virtual Tracker</strong> account was <strong>${escapeHtml(action)}</strong> successfully.</p>
      ${detailTableHtml([
        { label: "Event", value: isReset ? "Password reset completed" : "Password change completed" },
        { label: "Time", value: formatWhen() },
        { label: "Status", value: "<span style=\"color:#059669;font-weight:700;\">Confirmed</span>" },
      ])}
      ${calloutHtml(
        "warning",
        "Wasn't you?",
        `<p style="margin:0 0 8px;">If you did <strong>not</strong> make this change, your account may be compromised.</p>
         <p style="margin:0;">Reset your password immediately and contact support at <a href="mailto:${escapeHtml(supportEmail)}" style="color:#b45309;font-weight:600;text-decoration:none;">${escapeHtml(supportEmail)}</a>.</p>`,
      )}
    `.trim(),
    actionLabel: "Sign in to Virtual Tracker",
    actionHref: appSignInUrl(),
    footerHtml: supportFooterHtml(supportEmail),
  });

  return { subject, text, html };
}

/** @param {{ recipientName?: string; ip: string; deviceSummary: string; signedInAt?: string }} input */
export function buildNewSignInAlertEmail(input) {
  const name = greeting(input.recipientName);
  const ip = input.ip?.trim() || "Unknown";
  const device = input.deviceSummary?.trim() || "Unknown device";
  const when = formatWhen(input.signedInAt);
  const supportEmail = resolveSupportContactEmail();
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
    supportEmail,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "New sign-in detected",
    subtitle: "We noticed activity from a new device or location",
    badge: "Security alert",
    badgeVariant: "security",
    preheader: `New sign-in to Virtual Tracker from ${device}.`,
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 14px;">We detected a sign-in to your <strong>Virtual Tracker</strong> account. Review the details below and confirm this was you.</p>
      ${detailTableHtml([
        { label: "When", value: escapeHtml(when) },
        { label: "Device", value: escapeHtml(device) },
        { label: "IP address", value: escapeHtml(ip) },
      ])}
      ${calloutHtml(
        "success",
        "Recognize this activity?",
        "<p style=\"margin:0;\">If you just signed in, no further action is needed. We'll keep monitoring your account for unusual activity.</p>",
      )}
      ${calloutHtml(
        "danger",
        "Don't recognize this?",
        `<p style="margin:0;">Change your password right away and contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#dc2626;font-weight:600;text-decoration:none;">${escapeHtml(supportEmail)}</a>.</p>`,
      )}
    `.trim(),
    actionLabel: "Review my account",
    actionHref: appSignInUrl(),
    secondaryActionLabel: "Change password",
    secondaryActionHref: `${appSignInUrl().replace(/\/+$/, "")}/auth/action?mode=resetPassword`,
    footerHtml: supportFooterHtml(supportEmail),
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
  const subject = "You're invited to join Virtual Tracker";
  const text = [
    "Hello,",
    "",
    "You've been invited to join Virtual Tracker.",
    roleName ? `Role: ${roleName}` : "",
    "",
    "Open the link below to create your account and complete registration:",
    inviteUrl,
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "You're invited to the team",
    subtitle: roleName ? `Join as ${roleName}` : "Your organization is waiting for you",
    badge: "Invitation",
    badgeVariant: "invite",
    preheader: "Accept your Virtual Tracker invitation and create your account.",
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello,</p>
      <p style="margin:0 0 14px;">You've been invited to join <strong>Virtual Tracker</strong>${roleName ? ` as <strong>${escapeHtml(roleName)}</strong>` : ""}. Virtual Tracker helps teams track time, monitor activity, and manage workforce visibility in one place.</p>
      ${detailTableHtml([
        ...(roleName ? [{ label: "Your role", value: escapeHtml(roleName) }] : []),
        { label: "Invited email", value: escapeHtml(email) },
        { label: "Next step", value: "Create your account &amp; set a password" },
      ])}
      ${stepsListHtml([
        "Click <strong>Accept invitation</strong> below.",
        "Complete registration with your name and password.",
        "Sign in and start using your dashboard.",
      ])}
      ${calloutHtml(
        "info",
        "Not expecting this?",
        "<p style=\"margin:0;\">If you don't recognize this invitation, you can safely ignore this email.</p>",
      )}
    `.trim(),
    actionLabel: "Accept invitation",
    actionHref: inviteUrl,
    footerHtml: linkFallbackHtml(inviteUrl),
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

  const greetingName = greeting(input.displayName, "");
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
    title: "Your account is ready",
    subtitle: "An administrator set up access for you",
    badge: "Welcome",
    badgeVariant: "welcome",
    preheader: "Sign in with your temporary password — you'll choose a new one right away.",
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello${greetingName ? ` ${escapeHtml(greetingName)}` : ""},</p>
      <p style="margin:0 0 14px;">An administrator created a <strong>Virtual Tracker</strong> account for you. Use the credentials below for your first sign-in.</p>
      ${credentialPanelHtml(`
        <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Sign-in credentials</p>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#334155;"><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#334155;"><strong>Temporary password:</strong>
          <span style="display:inline-block;margin-top:4px;padding:8px 12px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:15px;font-weight:700;color:#0f172a;letter-spacing:0.04em;">${escapeHtml(temporaryPassword)}</span>
        </p>
      `)}
      ${calloutHtml(
        "warning",
        "Important",
        "<p style=\"margin:0;\">For your security, you <strong>must choose a new password</strong> immediately after signing in. Do not share your temporary password with anyone.</p>",
      )}
      ${stepsListHtml([
        "Click <strong>Sign in to Virtual Tracker</strong> below.",
        "Enter your email and temporary password.",
        "Follow the prompts to set a permanent password.",
      ])}
    `.trim(),
    actionLabel: "Sign in to Virtual Tracker",
    actionHref: signInUrl,
    footerHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">If you did not expect this account, contact your organization administrator.</p>`,
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[preprovision-email]" });
}

// ── Registration welcome ──────────────────────────────────────────────────────

/** @param {{ email: string; displayName?: string; signInUrl: string }} input */
export async function sendRegistrationWelcomeEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const signInUrl = typeof input.signInUrl === "string" ? input.signInUrl.trim() : "";
  if (!email || !signInUrl) return { sent: false, channel: "skipped" };

  const name = greeting(input.displayName);
  const subject = "Welcome to Virtual Tracker — you're all set";
  const text = [
    `Hello ${name},`,
    "",
    "Your email is verified and your Virtual Tracker account is ready.",
    "",
    `Sign in: ${signInUrl}`,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: `Welcome, ${name}!`,
    subtitle: "Your account is verified and ready to use",
    badge: "Welcome",
    badgeVariant: "welcome",
    preheader: "Your Virtual Tracker account is active — sign in to get started.",
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 14px;">Your email is verified and your <strong>Virtual Tracker</strong> account is fully active. You're ready to sign in and start tracking time, reviewing activity, and collaborating with your team.</p>
      ${detailTableHtml([
        { label: "Account", value: escapeHtml(email) },
        { label: "Status", value: "<span style=\"color:#059669;font-weight:700;\">Active &amp; verified</span>" },
      ])}
      ${calloutHtml(
        "success",
        "What's next?",
        `<p style="margin:0;">Sign in to complete your profile, explore your dashboard, and download the desktop tracker if your organization uses it.</p>`,
      )}
    `.trim(),
    actionLabel: "Go to my dashboard",
    actionHref: signInUrl,
    footerHtml: supportFooterHtml(resolveSupportContactEmail(), { showAutoNotice: false }),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[registration-welcome-email]" });
}

// ── Team transfer invite ──────────────────────────────────────────────────────

/** @param {{ email: string; transferUrl: string; requesterName?: string }} input */
export async function sendMemberTransferEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const transferUrl = typeof input.transferUrl === "string" ? input.transferUrl.trim() : "";
  if (!email || !transferUrl) return { sent: false, channel: "skipped" };

  const requester = input.requesterName?.trim() || "A team lead";
  const requesterLine = `${requester} has invited you to join their team on Virtual Tracker.`;
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
    subtitle: "Review and accept to join the team",
    badge: "Team transfer",
    badgeVariant: "invite",
    preheader: `${requester} invited you to join their team on Virtual Tracker.`,
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello,</p>
      <p style="margin:0 0 14px;"><strong>${escapeHtml(requester)}</strong> has invited you to join their team on <strong>Virtual Tracker</strong>. Accepting will update your reporting structure and team visibility.</p>
      ${detailTableHtml([
        { label: "Invited by", value: escapeHtml(requester) },
        { label: "Your email", value: escapeHtml(email) },
        { label: "Link expires", value: "Single-use · limited time" },
      ])}
      ${stepsListHtml([
        "Click <strong>Review invitation</strong> below.",
        "Read the transfer details on the confirmation page.",
        "Accept to join the new team structure.",
      ])}
      ${calloutHtml(
        "info",
        "Security note",
        "<p style=\"margin:0;\">This link is single-use and expires automatically. Do not forward it to others.</p>",
      )}
    `.trim(),
    actionLabel: "Review invitation",
    actionHref: transferUrl,
    footerHtml: linkFallbackHtml(transferUrl),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[transfer-email]" });
}

// ── Member ban notification ───────────────────────────────────────────────────

/** @param {{ email: string; memberName?: string; reason: string }} input */
export async function sendMemberBanEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!email || !reason) return { sent: false, channel: "skipped" };

  const memberName = greeting(input.memberName);
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
    title: "Account access restricted",
    subtitle: "An administrator has limited your access",
    badge: "Account notice",
    badgeVariant: "alert",
    preheader: "Your Virtual Tracker access has been restricted by an administrator.",
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(memberName)},</p>
      <p style="margin:0 0 14px;">Your access to <strong>Virtual Tracker</strong> has been restricted by an organization administrator. You will not be able to sign in until this restriction is lifted.</p>
      ${detailTableHtml([
        { label: "Account", value: escapeHtml(email) },
        { label: "Status", value: "<span style=\"color:#dc2626;font-weight:700;\">Access restricted</span>" },
        { label: "Reason", value: escapeHtml(reason) },
        { label: "Date", value: formatWhen() },
      ])}
      ${calloutHtml(
        "info",
        "Believe this is a mistake?",
        `<p style="margin:0;">Contact our support team at <a href="mailto:${escapeHtml(supportEmail)}" style="color:#2563eb;font-weight:600;text-decoration:none;">${escapeHtml(supportEmail)}</a> with your account email and any relevant details.</p>`,
      )}
    `.trim(),
    footerHtml: supportFooterHtml(supportEmail),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[ban-email]" });
}

// ── Landing page contact inquiry ──────────────────────────────────────────────

/** @param {{ to: string; name: string; fromEmail: string; topic?: string; teamSize?: string; message: string }} input */
export async function sendContactInquiryEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const fromEmail = typeof input.fromEmail === "string" ? input.fromEmail.trim().toLowerCase() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!to || !name || !fromEmail || !message) return { sent: false, channel: "skipped" };

  const topic = typeof input.topic === "string" && input.topic.trim() ? input.topic.trim() : "General";
  const teamSize = typeof input.teamSize === "string" && input.teamSize.trim() ? input.teamSize.trim() : "";
  const subject = `New inquiry: ${topic} — ${name}`;
  const text = [
    `New landing page inquiry from ${name} <${fromEmail}>`,
    "",
    `Topic: ${topic}`,
    teamSize ? `Team size: ${teamSize}` : "",
    "",
    "Message:",
    message,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: "New contact inquiry",
    subtitle: "Someone reached out from the landing page",
    badge: "Sales & support",
    badgeVariant: "report",
    preheader: `${name} submitted a ${topic} inquiry via the landing page.`,
    bodyHtml: `
      <p style="margin:0 0 14px;">A visitor submitted the contact form on <strong>myvirtualtracker.com</strong>. Details are below — reply directly to reach them.</p>
      ${detailTableHtml([
        { label: "Name", value: `<strong>${escapeHtml(name)}</strong>` },
        {
          label: "Email",
          value: `<a href="mailto:${escapeHtml(fromEmail)}" style="color:#6b38d4;font-weight:600;text-decoration:none;">${escapeHtml(fromEmail)}</a>`,
        },
        { label: "Topic", value: escapeHtml(topic) },
        ...(teamSize ? [{ label: "Team size", value: escapeHtml(teamSize) }] : []),
        { label: "Received", value: formatWhen() },
      ])}
      <p style="margin:20px 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Message</p>
      <div style="padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;line-height:1.65;color:#334155;white-space:pre-wrap;">${escapeHtml(message)}</div>
    `.trim(),
    actionLabel: "Reply to inquiry",
    actionHref: `mailto:${fromEmail}?subject=${encodeURIComponent(`Re: ${topic} — Virtual Tracker`)}`,
    footerHtml: `<p style="margin:0;font-size:13px;color:#64748b;">This inquiry was captured from the public contact form. Response time targets apply per your support SLA.</p>`,
  });

  return sendTransactionalEmail({ to, subject, text, html, logPrefix: "[contact-inquiry-email]" });
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
  const text = [
    `Weekly report for ${teamName}`,
    "",
    `Members on team: ${memberCount}`,
    "",
    `Open your dashboard: ${appUrl}`,
  ].join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: `Weekly report — ${teamName}`,
    subtitle: "Your team's snapshot for this week",
    badge: "Weekly report",
    badgeVariant: "report",
    preheader: `${teamName} weekly summary — ${memberCount} member${memberCount === 1 ? "" : "s"} on the team.`,
    bodyHtml: `
      <p style="margin:0 0 14px;">Here's your automated weekly summary for <strong>${escapeHtml(teamName)}</strong>. Open your dashboard for full activity, time tracked, and member details.</p>
      ${detailTableHtml([
        { label: "Team", value: escapeHtml(teamName) },
        { label: "Members", value: `<strong>${memberCount}</strong> active on team` },
        { label: "Period", value: "Last 7 days" },
        { label: "Generated", value: formatWhen() },
      ])}
      ${calloutHtml(
        "info",
        "Tip",
        "<p style=\"margin:0;\">Use the Reports section in your dashboard to drill into individual member activity, project hours, and productivity trends.</p>",
      )}
    `.trim(),
    actionLabel: "Open team dashboard",
    actionHref: appUrl,
    footerHtml: supportFooterHtml(resolveSupportContactEmail(), { showAutoNotice: false }),
  });

  return sendTransactionalEmail({ to: email, subject, text, html, logPrefix: "[team-weekly-report]" });
}

// ── Report delivery (Send / Schedule on a report page) ─────────────────────────

/**
 * @param {{
 *   email: string,
 *   subject?: string,
 *   message?: string,
 *   reportName?: string,
 *   attachment?: { filename: string, contentBase64: string, contentType: string },
 * }} input
 */
export async function sendReportDeliveryEmail(input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email) return { sent: false, channel: "skipped" };

  const reportName = typeof input.reportName === "string" && input.reportName.trim() ? input.reportName.trim() : "Report";
  const subject = typeof input.subject === "string" && input.subject.trim() ? input.subject.trim() : reportName;
  const message = typeof input.message === "string" ? input.message.trim() : "";

  const text = [message, "", `Attached: ${input.attachment?.filename ?? reportName}`].filter(Boolean).join("\n");

  const html = buildAuthBrandedEmailHtml({
    title: reportName,
    subtitle: "Shared from your dashboard",
    badge: "Report",
    badgeVariant: "report",
    preheader: message || `${reportName} is attached.`,
    bodyHtml: `
      ${message ? `<p style="margin:0 0 14px;">${escapeHtml(message).replace(/\n/g, "<br/>")}</p>` : ""}
      ${calloutHtml(
        "info",
        "Attachment",
        `<p style="margin:0;">${escapeHtml(input.attachment?.filename ?? reportName)} is attached to this email.</p>`,
      )}
    `.trim(),
    footerHtml: supportFooterHtml(resolveSupportContactEmail(), { showAutoNotice: false }),
  });

  const attachments = input.attachment
    ? [
        {
          filename: input.attachment.filename,
          content: Buffer.from(input.attachment.contentBase64, "base64"),
          contentType: input.attachment.contentType,
        },
      ]
    : undefined;

  return sendTransactionalEmail({ to: email, subject, text, html, attachments, logPrefix: "[report-delivery]" });
}
