import { getEnv } from "../../config/env.js";

export function getEmailDeliveryConfig() {
  const { email } = getEnv();

  if (email.smtpHost && email.smtpUser && email.smtpPass) {
    const from = email.smtpFrom || `Virtual Tracker <${email.smtpUser}>`;
    return { configured: true, from };
  }

  return { configured: false, from: "" };
}

export function logEmailDeliveryStatus() {
  const config = getEmailDeliveryConfig();
  if (config.configured) {
    console.info(`[email] SMTP delivery enabled (from: ${config.from})`);
    return;
  }
  console.warn(
    "[email] SMTP not configured — emails will be logged to the console only.\n" +
      "  Add to Notify-Backend/.env:\n" +
      "    SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_USER=you@gmail.com\n" +
      "    SMTP_PASS=your-app-password  SMTP_FROM=Virtual Tracker <you@gmail.com>",
  );
}

export async function logEmailDeliveryStatusAsync() {
  logEmailDeliveryStatus();
  const config = getEmailDeliveryConfig();
  if (!config.configured) return;

  const { verifySmtpDelivery } = await import("./transactional-email.js");
  const result = await verifySmtpDelivery();
  if (result.ok) {
    console.info("[email] SMTP login verified.");
    return;
  }
  console.error(
    "[email] SMTP login FAILED — emails will not send until this is fixed.\n" +
      `       ${result.error || "Unknown SMTP error"}\n` +
      "       Use a Google App Password (not your normal password) for SMTP_PASS.",
  );
}
