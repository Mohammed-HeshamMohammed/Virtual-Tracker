import { query } from "./client.js";

const COLUMNS = `saturation_events, window_ms, screenshot_min_delay_sec, screenshot_max_delay_sec,
                 idle_threshold_sec, idle_warn_sec, idle_alert_sec, idle_stop_sec, updated_by, updated_at`;

// ACT-3: mirrors the Rust constants these override, so shipping this table is
// a no-op until an admin actually tunes something.
const DEFAULTS = {
  saturation_events: 120,
  window_ms: 60000,
  screenshot_min_delay_sec: 90,
  screenshot_max_delay_sec: 210,
  idle_threshold_sec: 60,
  idle_warn_sec: 300,
  idle_alert_sec: 600,
  idle_stop_sec: 900,
};

export async function getActivityScoringSettingsPg() {
  const rows = await query(`SELECT ${COLUMNS} FROM activity_scoring_settings WHERE id = 1 LIMIT 1`);
  return rows[0] ?? DEFAULTS;
}

/**
 * @param {{
 *   saturationEvents?: number, windowMs?: number,
 *   screenshotMinDelaySec?: number, screenshotMaxDelaySec?: number,
 *   idleThresholdSec?: number, idleWarnSec?: number, idleAlertSec?: number, idleStopSec?: number,
 *   updatedBy?: string,
 * }} input
 */
export async function setActivityScoringSettingsPg(input) {
  const rows = await query(
    `UPDATE activity_scoring_settings SET
       saturation_events = COALESCE($1, saturation_events),
       window_ms = COALESCE($2, window_ms),
       screenshot_min_delay_sec = COALESCE($3, screenshot_min_delay_sec),
       screenshot_max_delay_sec = COALESCE($4, screenshot_max_delay_sec),
       idle_threshold_sec = COALESCE($5, idle_threshold_sec),
       idle_warn_sec = COALESCE($6, idle_warn_sec),
       idle_alert_sec = COALESCE($7, idle_alert_sec),
       idle_stop_sec = COALESCE($8, idle_stop_sec),
       updated_by = $9,
       updated_at = now()
     WHERE id = 1
     RETURNING ${COLUMNS}`,
    [
      input.saturationEvents ?? null,
      input.windowMs ?? null,
      input.screenshotMinDelaySec ?? null,
      input.screenshotMaxDelaySec ?? null,
      input.idleThresholdSec ?? null,
      input.idleWarnSec ?? null,
      input.idleAlertSec ?? null,
      input.idleStopSec ?? null,
      input.updatedBy ?? null,
    ],
  );
  return rows[0] ?? null;
}
