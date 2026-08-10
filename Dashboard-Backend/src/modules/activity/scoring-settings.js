import { isManagementRole } from "../../http/auth-context.js";
import {
  getActivityScoringSettingsPg,
  setActivityScoringSettingsPg,
} from "../../lib/postgres/activity-scoring-postgres.service.js";

// ACT-3: every server-tunable agent constant the plan names, one validated
// field per row. `code` is what tests/callers match on; `pg` is the key
// setActivityScoringSettingsPg expects.
const FIELDS = [
  { key: "saturationEvents", pg: "saturationEvents", code: "INVALID_SATURATION_EVENTS" },
  { key: "windowMs", pg: "windowMs", code: "INVALID_WINDOW_MS" },
  { key: "screenshotMinDelaySec", pg: "screenshotMinDelaySec", code: "INVALID_SCREENSHOT_MIN_DELAY_SEC" },
  { key: "screenshotMaxDelaySec", pg: "screenshotMaxDelaySec", code: "INVALID_SCREENSHOT_MAX_DELAY_SEC" },
  { key: "idleThresholdSec", pg: "idleThresholdSec", code: "INVALID_IDLE_THRESHOLD_SEC" },
  { key: "idleWarnSec", pg: "idleWarnSec", code: "INVALID_IDLE_WARN_SEC" },
  { key: "idleAlertSec", pg: "idleAlertSec", code: "INVALID_IDLE_ALERT_SEC" },
  { key: "idleStopSec", pg: "idleStopSec", code: "INVALID_IDLE_STOP_SEC" },
];

function normalize(row) {
  return {
    saturationEvents: row.saturation_events,
    windowMs: row.window_ms,
    screenshotMinDelaySec: row.screenshot_min_delay_sec,
    screenshotMaxDelaySec: row.screenshot_max_delay_sec,
    idleThresholdSec: row.idle_threshold_sec,
    idleWarnSec: row.idle_warn_sec,
    idleAlertSec: row.idle_alert_sec,
    idleStopSec: row.idle_stop_sec,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** ACT-3: current agent calibration - what the agent polls periodically. */
export async function getActivityScoringSettings() {
  return normalize(await getActivityScoringSettingsPg());
}

/**
 * @param {Partial<Record<'saturationEvents'|'windowMs'|'screenshotMinDelaySec'|'screenshotMaxDelaySec'|'idleThresholdSec'|'idleWarnSec'|'idleAlertSec'|'idleStopSec', number>>} input
 * @param {{ memberId: string, roleName: string }} actor
 */
export async function setActivityScoringSettings(input, actor) {
  for (const field of FIELDS) {
    const value = input[field.key];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      const err = new Error(`${field.key} must be a positive number.`);
      err.code = field.code;
      throw err;
    }
  }

  // Idle escalation only makes sense warn < alert < stop - validated against
  // the merged (current + incoming) view so a partial update can't leave the
  // stored row internally contradictory even though it only touched one field.
  const current = await getActivityScoringSettings();
  const merged = { ...current, ...Object.fromEntries(FIELDS.map((f) => [f.key, input[f.key] ?? current[f.key]])) };
  if (!(merged.idleWarnSec < merged.idleAlertSec && merged.idleAlertSec < merged.idleStopSec)) {
    const err = new Error("Idle thresholds must satisfy idleWarnSec < idleAlertSec < idleStopSec.");
    err.code = "INVALID_IDLE_ORDER";
    throw err;
  }
  if (merged.screenshotMinDelaySec > merged.screenshotMaxDelaySec) {
    const err = new Error("screenshotMinDelaySec must not exceed screenshotMaxDelaySec.");
    err.code = "INVALID_SCREENSHOT_DELAY_ORDER";
    throw err;
  }

  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change activity scoring settings.");
    err.code = "FORBIDDEN";
    throw err;
  }

  const pgInput = { updatedBy: actor.memberId };
  for (const field of FIELDS) {
    if (input[field.key] !== undefined) pgInput[field.pg] = Math.floor(input[field.key]);
  }
  const row = await setActivityScoringSettingsPg(pgInput);
  return row ? normalize(row) : null;
}
