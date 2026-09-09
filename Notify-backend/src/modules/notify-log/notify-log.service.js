import { dbQuery } from "../../lib/db.js";

const EMAIL_COOLDOWNS = {
  verification: "2 minutes",
  "password-updated": "10 minutes",
  "new-sign-in-alert": "5 minutes",
  "member-invite": "5 minutes",
  "preprovision-welcome": "30 minutes",
  "registration-welcome": "1 hour",
  "transfer-invite": "10 minutes",
  "member-ban": "1 hour",
  "team-weekly-report": "6 hours",
  "report-delivery": "1 minute",
};

const DEFAULT_EMAIL_COOLDOWN = "5 minutes";
const DEFAULT_PUSH_COOLDOWN = "1 minute";

export async function isDuplicate({ recipient, template, channel }) {
  const cooldown =
    channel === "email"
      ? (EMAIL_COOLDOWNS[template] ?? DEFAULT_EMAIL_COOLDOWN)
      : DEFAULT_PUSH_COOLDOWN;

  const rows = await dbQuery(
    `SELECT id FROM notification_deliveries
     WHERE recipient = $1
       AND template  = $2
       AND channel   = $3
       AND status    = 'sent'
       AND sent_at  > now() - $4::INTERVAL
     LIMIT 1`,
    [recipient, template, channel, cooldown],
  );

  if (rows === null) return false;
  return rows.length > 0;
}

export async function logDelivery({
  channel,
  template,
  recipient,
  recipientMemberId = null,
  status,
  errorMessage = null,
  metadata = null,
}) {
  await dbQuery(
    `INSERT INTO notification_deliveries
       (channel, template, recipient, recipient_member_id,
        status, error_message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      channel,
      template,
      recipient,
      recipientMemberId ?? null,
      status,
      errorMessage ?? null,
      metadata != null ? JSON.stringify(metadata) : null,
    ],
  );
}
