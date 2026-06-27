import nodemailer from "nodemailer";
import { getEnv } from "../../config/env.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { getEmailDeliveryConfig } from "./email-config.js";

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { escapeHtml };

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

/**
 * Verify SMTP credentials at startup (surfaces 535 login errors immediately).
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
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

/**
 * @param {{ to: string; subject: string; text: string; html: string; from: string; logPrefix: string }} input
 * @returns {Promise<{ sent: boolean; channel: string; error?: string }>}
 */
async function sendViaResend(input) {
  const resendKey = getEnv().email.resendApiKey;
  if (!resendKey) return { sent: false, channel: "resend_skipped" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
    if (res.ok) return { sent: true, channel: "resend" };
    const body = await res.text().catch(() => "");
    const err = `Resend HTTP ${res.status}: ${body.slice(0, 200)}`;
    logSafeWarn(`${input.logPrefix} ${err}`);
    return { sent: false, channel: "resend_failed", error: err };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logSafeWarn(`${input.logPrefix} Resend error:`, err);
    return { sent: false, channel: "resend_failed", error: msg };
  }
}

/**
 * @param {{ to: string; subject: string; text: string; html: string; from: string; logPrefix: string }} input
 * @returns {Promise<{ sent: boolean; channel: string; error?: string }>}
 */
async function sendViaSmtp(input) {
  const transporter = getSmtpTransporter();
  if (!transporter) return { sent: false, channel: "smtp_skipped" };

  try {
    await transporter.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { sent: true, channel: "smtp" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logSafeWarn(`${input.logPrefix} SMTP error:`, err);
    return { sent: false, channel: "smtp_failed", error: msg };
  }
}

/**
 * Sends email via Resend or SMTP when configured; otherwise logs to console (dev/demo).
 *
 * @param {{ to: string; subject: string; text: string; html: string; logPrefix?: string }} input
 * @returns {Promise<{ sent: boolean; channel: string; error?: string }>}
 */
export async function sendTransactionalEmail(input) {
  const to = typeof input.to === "string" ? input.to.trim().toLowerCase() : "";
  if (!to) return { sent: false, channel: "skipped" };

  const logPrefix = input.logPrefix || "[transactional-email]";
  const delivery = getEmailDeliveryConfig();
  const payload = {
    to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    from: delivery.from || "Virtual Tracker <noreply@localhost>",
    logPrefix,
  };

  if (delivery.channel === "resend") {
    const result = await sendViaResend(payload);
    if (result.sent) return result;
    if (delivery.configured) return result;
  }

  if (delivery.channel === "smtp" || getSmtpTransporter()) {
    const result = await sendViaSmtp(payload);
    if (result.sent) return result;
    if (delivery.channel === "smtp") return result;
  }

  console.info(
    `${logPrefix} Email for ${to} (no mail provider configured — copy content below):\n${input.text}\n` +
      "Configure RESEND_API_KEY or SMTP_* in Backend/.env to deliver real email.",
  );
  return { sent: false, channel: "console" };
}
