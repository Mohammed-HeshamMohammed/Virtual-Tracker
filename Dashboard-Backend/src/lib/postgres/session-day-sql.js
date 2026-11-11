/**
 * Which calendar day tracked time belongs to - one rule, used by every query that cuts
 * time into days (PLAN-timezone-and-day-boundary.md; owner's decision 2026-10-22).
 *
 * A session's day is the local date its `started_at` falls on in the session's zone, and
 * that zone is the project's, in the same order `resolveProjectTimeZone` uses:
 *   1. the member's own override on that project (project_members.timezone),
 *   2. the project's zone,
 *   3. the member's own zone,
 *   4. UTC.
 *
 * Screenshots, app and URL logs belong to the day of the session they were captured in, so
 * the Apps & URLs figures sit on the same day as the time they explain. A row whose session
 * is gone (retention, deletion) falls back to its own timestamp in the member's zone.
 *
 * Correlated sub-selects rather than joins, so each call site is a drop-in replacement for
 * the expression it used before, whatever it already joins.
 */

/** The zone a session's time is booked in. `s` is the activity_sessions alias in scope. */
export function sessionZoneSql(s) {
  return `COALESCE(
    (SELECT NULLIF(pm_tz.timezone, '') FROM project_members pm_tz
      WHERE pm_tz.project_id = ${s}.project_id AND pm_tz.member_id = ${s}.member_id LIMIT 1),
    (SELECT NULLIF(p_tz.timezone, '') FROM projects p_tz WHERE p_tz.id = ${s}.project_id),
    (SELECT NULLIF(mz.timezone, '') FROM members mz WHERE mz.id = ${s}.member_id),
    'UTC')`;
}

/** The day a session's time belongs to. */
export function sessionDaySql(s) {
  return `(${s}.started_at AT TIME ZONE ${sessionZoneSql(s)})::date`;
}

const UUID_PATTERN = "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'";

/**
 * The day a screenshot / app log / URL log belongs to. `row` is its alias, `tsColumn` its own
 * timestamp column. session_id is text on these tables; it is cast only when it is a uuid,
 * which also keeps the lookup on activity_sessions' primary key.
 */
export function eventDaySql(row, tsColumn) {
  return `COALESCE(
    (SELECT ${sessionDaySql("ev_s")} FROM activity_sessions ev_s
      WHERE ev_s.id = CASE WHEN ${row}.session_id ~ ${UUID_PATTERN} THEN ${row}.session_id::uuid END),
    (${tsColumn} AT TIME ZONE COALESCE(
      (SELECT NULLIF(mz.timezone, '') FROM members mz WHERE mz.id = ${row}.member_id), 'UTC'))::date)`;
}
