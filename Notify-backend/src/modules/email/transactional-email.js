import nodemailer from "nodemailer";
import { getEnv } from "../../config/env.js";
import { getEmailDeliveryConfig } from "./email-config.js";

export { escapeHtml } from "./email-template.js";

let smtpTransporter = null;

function normalizeSmtpPass(pass) {
  return typeof pass === "string" ? pass.replace(/\s+/g, "") : "";
}

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const { email } = getEnv();
  const { smtpHost: host, smtpUser: user, smtpPass: pass, smtpPort: port, smtpSecure } = email;
  const normalizedPass = normalizeSmtpPass(pass);
  if (!host || !user || !normalizedPass) return null;

  const secure = smtpSecure || port === 465;
  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: normalizedPass },
  });
  return smtpTransporter;
}

export async function verifySmtpDelivery() {
  const transporter = getSmtpTransporter();
  if (!transporter) return { ok: false, error: "SMTP is not configured." };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.replace(/\s+/g, " ").trim() };
  }
}

export async function sendTransactionalEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };

  const logPrefix = input.logPrefix || "[transactional-email]";
  const delivery = getEmailDeliveryConfig();
  const transporter = getSmtpTransporter();

  if (transporter) {
    try {
      await transporter.sendMail({
        from: delivery.from || "Virtual Tracker <noreply@localhost>",
        to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments,
      });
      return { sent: true, channel: "smtp" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${logPrefix} SMTP error:`, msg);
      return { sent: false, channel: "smtp_failed", error: msg };
    }
  }

  // The body is only echoed outside production. It carries verification and
  // password-reset links, so in a deployed environment that has lost its SMTP
  // config this would write working credentials into the log file - a dev
  // convenience turning into a credential leak exactly when something is
  // already misconfigured.
  if (process.env.NODE_ENV === "production") {
    console.warn(
      `${logPrefix} SMTP is not configured - email to ${to} ("${input.subject}") was NOT delivered. ` +
        "Configure SMTP_* to send real email.",
    );
  } else {
    console.info(
      `${logPrefix} Email for ${to} (SMTP not configured — copy content below):\n${input.text}\n` +
        "Configure SMTP_* in Notify-Backend/.env to deliver real email.",
    );
  }
  return { sent: false, channel: "console" };
}
