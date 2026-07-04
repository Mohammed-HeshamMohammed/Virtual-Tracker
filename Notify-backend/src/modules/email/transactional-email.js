// SMTP sender for transactional emails.
import nodemailer from "nodemailer";
import { getEnv } from "../../config/env.js";
import { getEmailDeliveryConfig } from "./email-config.js";

export { escapeHtml } from "./email-template.js";

/** @type {import("nodemailer").Transporter | null} */
let smtpTransporter = null;

/** Gmail app passwords are 16 chars; strip spaces from .env paste. */
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

/** SMTP verify at startup — catches 535 login errors early. */
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

/** Send via SMTP; console fallback when unconfigured. @param {{ to: string; subject: string; text: string; html: string; logPrefix?: string }} input @returns {Promise<{ sent: boolean; channel: string; error?: string }>} */
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
      });
      return { sent: true, channel: "smtp" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${logPrefix} SMTP error:`, msg);
      return { sent: false, channel: "smtp_failed", error: msg };
    }
  }

  // Dev fallback — log content to console when SMTP is not configured.
  console.info(
    `${logPrefix} Email for ${to} (SMTP not configured — copy content below):\n${input.text}\n` +
      "Configure SMTP_* in Notify-Backend/.env to deliver real email.",
  );
  return { sent: false, channel: "console" };
}
