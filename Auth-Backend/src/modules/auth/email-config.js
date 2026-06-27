import { getEnv } from "../../config/env.js";

/**
 * @returns {{ configured: boolean; channel: "resend" | "smtp" | "none"; from: string }}
 */
export function getEmailDeliveryConfig() {
  const { email } = getEnv();

  if (email.resendApiKey) {
    return { configured: true, channel: "resend", from: email.resendFrom };
  }

  if (email.smtpHost && email.smtpUser && email.smtpPass) {
    const from = email.smtpFrom || `Virtual Tracker <${email.smtpUser}>`;
    return { configured: true, channel: "smtp", from };
  }

  return { configured: false, channel: "none", from: "" };
}

export function logEmailDeliveryStatus() {
  const config = getEmailDeliveryConfig();
  if (config.configured) {
    console.info(`[email] Outbound delivery enabled via ${config.channel} (from: ${config.from})`);
    return;
  }
  console.warn(
    "[email] Outbound delivery NOT configured — invite/account emails are logged to the console only.\n" +
      "  Add to Backend/.env (pick one):\n" +
      "    RESEND_API_KEY=re_...  and  RESEND_FROM=Virtual Tracker <onboarding@yourdomain.com>\n" +
      "  OR SMTP (Gmail/Outlook):\n" +
      "    SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_USER=you@gmail.com  SMTP_PASS=app-password  SMTP_FROM=Virtual Tracker <you@gmail.com>",
  );
}

/** Logs provider status and verifies SMTP login when configured. */
export async function logEmailDeliveryStatusAsync() {
  logEmailDeliveryStatus();
  const config = getEmailDeliveryConfig();
  if (config.channel !== "smtp") return;

  const { verifySmtpDelivery } = await import("./transactional-email.js");
  const result = await verifySmtpDelivery();
  if (result.ok) {
    console.info("[email] SMTP login verified.");
    return;
  }
  console.error(
    "[email] SMTP login FAILED — invite emails will not send until this is fixed.\n" +
      `       ${result.error || "Unknown SMTP error"}\n` +
      "       Use a Google App Password (not your normal password) for SMTP_PASS, then restart the backend.\n" +
      "       Test: npm run test:email -- you@example.com",
  );
}
