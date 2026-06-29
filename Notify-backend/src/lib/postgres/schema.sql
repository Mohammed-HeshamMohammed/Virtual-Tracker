-- Notify-Backend delivery log schema (optional — requires POSTGRES_URL)
-- Run once against your PostgreSQL instance before enabling delivery logging.

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             TEXT NOT NULL CHECK (channel IN ('email', 'push', 'sms')),
  template            TEXT NOT NULL,
  recipient           TEXT NOT NULL,
  recipient_member_id TEXT,
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message       TEXT,
  metadata            JSONB,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_dedup
  ON notification_deliveries (recipient, template, channel, status, sent_at DESC);
