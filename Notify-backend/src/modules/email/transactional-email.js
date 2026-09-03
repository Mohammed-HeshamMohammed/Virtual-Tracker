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

  console.info(
    `${logPrefix} Email for ${to} (SMTP not configured — copy content below):\n${input.text}\n` +
      "Configure SMTP_* in Notify-Backend/.env to deliver real email.",
  );
  return { sent: false, channel: "console" };
}
