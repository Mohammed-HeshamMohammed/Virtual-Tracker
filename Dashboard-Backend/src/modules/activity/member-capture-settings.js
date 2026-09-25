import { query } from "../../lib/postgres/client.js";
import { isManagementRole } from "../../http/auth-context.js";
import { getActivityScoringSettings } from "./scoring-settings.js";
import { localDayFor, weekdayIndexForLocalDay, localMidnightUtc } from "../../lib/time/timezone-utils.js";
import { getMemberTimezone } from "../reports/member-timezones.js";

const MAX_BREAK_MINUTES = 240;

const OVERRIDES = [
  ["screenshotMinDelaySec", "screenshot_min_delay_sec", "int"],
  ["screenshotMaxDelaySec", "screenshot_max_delay_sec", "int"],
  ["blurDefault", "blur_default", "bool"],
  ["workStartMin", "work_start_min", "minute"],
  ["workEndMin", "work_end_min", "minute"],
];

function invalid(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function coerce(key, kind, value) {
  if (value === null) return null;
  if (kind === "bool") {
    if (typeof value !== "boolean") throw invalid(`${key} must be a boolean.`, "INVALID_CAPTURE_SETTING");
    return value;
  }
  if (!Number.isFinite(value)) throw invalid(`${key} must be a number.`, "INVALID_CAPTURE_SETTING");
  const n = Math.floor(value);
  if (kind === "int" && n <= 0) throw invalid(`${key} must be positive.`, "INVALID_CAPTURE_SETTING");
  if (kind === "minute" && (n < 0 || n > 1439)) throw invalid(`${key} must be 0-1439.`, "INVALID_CAPTURE_SETTING");
  return n;
}

async function memberRow(memberId) {
  const rows = await query(
    `SELECT screenshot_min_delay_sec, screenshot_max_delay_sec, blur_default,
            work_start_min, work_end_min, break_until, break_reason
       FROM member_capture_settings WHERE member_id = $1`,
    [memberId],
  );
  return rows[0] ?? {};
}

/**
 * Decided here rather than in the agent: the member's timezone and DST rules
 * already live on this side, and duplicating them in Rust would be a second
 * implementation to keep in step. The agent only obeys the answer.
 */
export function isOutsideWorkWindow(row, workDays, now, timeZone) {
  const localDay = localDayFor(now, timeZone);
  if (Array.isArray(workDays) && workDays.length && !workDays.includes(weekdayIndexForLocalDay(localDay))) {
    return true;
  }
  const start = row.work_start_min;
  const end = row.work_end_min;
  if (start == null || end == null || start === end) return false;

  const minute = Math.floor((now.getTime() - localMidnightUtc(localDay, timeZone).getTime()) / 60000);
  // end < start is an overnight shift, so the allowed range wraps midnight.
  return start <= end ? minute < start || minute >= end : minute < start && minute >= end;
}

/**
 * The weekdays capture is allowed on, or null when days off do not block capture.
 *
 * work_days defaults to Monday-Friday for everyone, and the flag that makes days
 * off actually stop tracking - disable_tracking_specific_days - defaults to
 * false. Reading work_days without it turned a default nobody chose into a rule:
 * every member with a settings row stopped being captured on Saturday and
 * Sunday. Nothing else in the product blocks anything on a day off (workingToday
 * only drives a prompt), so this must not either unless an organization opted in.
 * Members scheduled by shifts have no fixed work days at all, and a make-up day
 * is a day off that has been worked in lieu.
 */
export function enforcedWorkDays(settings) {
  if (!settings || settings.disable_tracking_specific_days !== true) return null;
  if (settings.use_shifts_for_limits === true) return null;
  const days = Array.isArray(settings.work_days) ? settings.work_days : [];
  const makeup = Array.isArray(settings.makeup_days) ? settings.makeup_days : [];
  return [...new Set([...days, ...makeup])];
}

const MAX_RECHECK_SEC = 30 * 60;

/**
 * How long until the work-window answer next flips, capped at the agent's own
 * poll interval. The agent re-reads its policy every thirty minutes, so without
 * this a shift ending at 18:00 kept capturing until the next poll - up to half
 * an hour of someone's evening - and one starting at 09:00 began late. Telling
 * the agent when to ask again fixes the edge without polling faster all day,
 * and keeps the timezone maths here rather than teaching the agent about DST.
 */
export function secondsUntilWindowChange(row, workDays, now, timeZone, currentlyOutside) {
  for (let minutes = 1; minutes <= MAX_RECHECK_SEC / 60; minutes++) {
    const later = new Date(now.getTime() + minutes * 60_000);
    if (isOutsideWorkWindow(row, workDays, later, timeZone) !== currentlyOutside) return minutes * 60;
  }
  return MAX_RECHECK_SEC;
}

/** The one payload the agent polls. Member overrides win; NULL inherits. */
export async function getEffectiveCaptureSettings(memberId) {
  const [org, row, scheduleRows, timeZone] = await Promise.all([
    getActivityScoringSettings(),
    memberRow(memberId),
    query(
      `SELECT work_days, makeup_days, disable_tracking_specific_days, use_shifts_for_limits
         FROM time_settings WHERE member_id = $1`,
      [memberId],
    ),
    getMemberTimezone(memberId).catch(() => "UTC"),
  ]);

  const now = new Date();
  const breakUntil = row.break_until ? new Date(row.break_until) : null;
  const onBreak = Boolean(breakUntil && breakUntil.getTime() > now.getTime());
  const zone = timeZone || "UTC";
  const workDays = enforcedWorkDays(scheduleRows[0]);
  // Independent of the break: when the break ends the agent still needs to know
  // whether the schedule blocks capture, and it would have to wait for the next
  // poll to learn that if the two were folded together.
  const outsideHours = isOutsideWorkWindow(row, workDays, now, zone);

  return {
    ...org,
    screenshotMinDelaySec: row.screenshot_min_delay_sec ?? org.screenshotMinDelaySec,
    screenshotMaxDelaySec: row.screenshot_max_delay_sec ?? org.screenshotMaxDelaySec,
    blurDefault: row.blur_default ?? false,
    workStartMin: row.work_start_min ?? null,
    workEndMin: row.work_end_min ?? null,
    captureBlocked: onBreak || outsideHours,
    captureBlockReason: onBreak ? "break" : outsideHours ? "outside_work_hours" : null,
    outsideWorkHours: outsideHours,
    recheckInSec: secondsUntilWindowChange(row, workDays, now, zone, outsideHours),
    breakUntilMs: onBreak ? breakUntil.getTime() : 0,
    breakReason: onBreak ? row.break_reason ?? null : null,
  };
}

/**
 * Who may read or change a member's capture settings.
 *
 * These carry a person's working hours and, while one is running, the reason
 * they gave for a private break - so being signed in is not enough. A member
 * reads their own; management reads and changes those inside their reach,
 * where `visibleIds` is null for a role that reaches everyone. Changing is
 * never self-service: cadence, blur and hours are the organization's to set,
 * and only the break is the member's own.
 */
export function mayAccessMemberCaptureSettings(viewer, targetMemberId, visibleIds, { write = false } = {}) {
  if (!viewer?.memberId || !targetMemberId) return false;
  const isSelf = viewer.memberId === targetMemberId;
  if (isSelf && !write) return true;
  if (!isManagementRole(viewer.roleName)) return false;
  return visibleIds === null || (Array.isArray(visibleIds) && visibleIds.includes(targetMemberId));
}

export async function setMemberCaptureSettings(memberId, input, actor) {
  if (!isManagementRole(actor?.roleName)) {
    throw invalid("Only management may change capture settings.", "FORBIDDEN");
  }
  const columns = [];
  const values = [memberId];
  for (const [key, column, kind] of OVERRIDES) {
    if (input[key] === undefined) continue;
    values.push(coerce(key, kind, input[key]));
    columns.push([column, `$${values.length}`]);
  }
  if (!columns.length) return getEffectiveCaptureSettings(memberId);

  values.push(actor.memberId);
  columns.push(["updated_by", `$${values.length}`]);

  await query(
    `INSERT INTO member_capture_settings (member_id, ${columns.map((c) => c[0]).join(", ")})
     VALUES ($1, ${columns.map((c) => c[1]).join(", ")})
     ON CONFLICT (member_id) DO UPDATE
       SET ${columns.map((c) => `${c[0]} = EXCLUDED.${c[0]}`).join(", ")}, updated_at = now()`,
    values,
  );
  return getEffectiveCaptureSettings(memberId);
}

/** The member's own privacy break. Always self-service, never on someone else. */
export async function startPrivateBreak(memberId, minutes, reason) {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_BREAK_MINUTES) {
    throw invalid(`Break must be 1-${MAX_BREAK_MINUTES} minutes.`, "INVALID_BREAK");
  }
  const text = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  if (!text) throw invalid("A reason is required.", "INVALID_BREAK_REASON");

  const rows = await query(
    `INSERT INTO member_capture_settings (member_id, break_until, break_reason, updated_by)
     VALUES ($1, now() + ($2 || ' minutes')::interval, $3, $1)
     ON CONFLICT (member_id) DO UPDATE
       SET break_until = EXCLUDED.break_until, break_reason = EXCLUDED.break_reason, updated_at = now()
     RETURNING break_until, break_reason`,
    [memberId, String(n), text],
  );
  return { breakUntil: rows[0]?.break_until ?? null, breakReason: rows[0]?.break_reason ?? null };
}

export async function endPrivateBreak(memberId) {
  await query(
    "UPDATE member_capture_settings SET break_until = NULL, break_reason = NULL, updated_at = now() WHERE member_id = $1",
    [memberId],
  );
  return { breakUntil: null, breakReason: null };
}

/** What was collected about this member today, in their own timezone. */
export async function getMyCaptureSummary(memberId, timezone) {
  const zone = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
  const rows = await query(
    `WITH bounds AS (
       SELECT date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2 AS day_start
     )
     SELECT
       (SELECT count(*) FROM activity_screenshots s, bounds b
         WHERE s.member_id = $1 AND s.captured_at >= b.day_start)::int AS screenshots,
       (SELECT count(*) FROM activity_app_logs a, bounds b
         WHERE a.member_id = $1 AND a.started_at >= b.day_start)::int AS app_events,
       (SELECT count(DISTINCT a.app_id) FROM activity_app_logs a, bounds b
         WHERE a.member_id = $1 AND a.started_at >= b.day_start)::int AS apps,
       (SELECT count(DISTINCT u.domain) FROM activity_url_logs u, bounds b
         WHERE u.member_id = $1 AND u.visited_at >= b.day_start)::int AS domains,
       (SELECT COALESCE(sum(d.active_seconds), 0) FROM daily_member_active_seconds d
         WHERE d.member_id = $1 AND d.day = (SELECT (day_start AT TIME ZONE $2)::date FROM bounds))::int AS active_seconds`,
    [memberId, zone],
  );
  const row = rows[0] ?? {};
  return {
    timezone: zone,
    screenshots: row.screenshots ?? 0,
    appEvents: row.app_events ?? 0,
    apps: row.apps ?? 0,
    domains: row.domains ?? 0,
    activeSeconds: row.active_seconds ?? 0,
  };
}
