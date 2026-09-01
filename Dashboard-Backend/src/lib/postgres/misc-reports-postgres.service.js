// Query functions backing the report types that already have real tables
// (activity_sessions, daily_member_active_seconds, pay_rates, audit_logs,
// limits, timesheets) but had no reporting endpoint yet. Mirrors the
// conventions in time-and-activity-report-postgres.service.js: seconds/raw
// values out, formatting stays on the frontend.
import { query } from "./client.js";

function toDayString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : "";
}

/**
 * Per-member per-day tracked seconds + current pay rate - backs Amounts Owed,
 * Daily Totals, and Payments (all the same "hours x rate" shape, grouped
 * differently on the frontend).
 * `projectIds` narrows to time tracked against tasks in those projects. That
 * has to come from the per-task rollup rather than daily_member_active_seconds,
 * which carries no project dimension at all - so a project-filtered total
 * counts task-attributed time only, and excludes time tracked with no task.
 * Unfiltered (the default) still reads the plain daily rollup, which includes
 * everything.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, projectIds?: string[] | null }} params
 */
export async function getMemberDailyAmountRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const hasProjectFilter = Array.isArray(projectIds) && projectIds.length > 0;
  const rows = hasProjectFilter
    ? await query(
        `SELECT dt.member_id, dt.day, SUM(dt.active_seconds) AS active_seconds,
                MIN(pr.rate) AS rate, MIN(pr.type) AS rate_type, MIN(pr.currency) AS currency
         FROM daily_member_task_active_seconds dt
         JOIN tasks t ON t.id = dt.task_id
         LEFT JOIN pay_rates pr ON pr.member_id = dt.member_id
         WHERE dt.day >= $1 AND dt.day <= $2
           AND ($3::uuid[] IS NULL OR dt.member_id = ANY($3::uuid[]))
           AND t.project_id = ANY($4::uuid[])
         GROUP BY dt.member_id, dt.day
         ORDER BY dt.day ASC`,
        [fromDay, toDay, memberIds, projectIds],
      )
    : await query(
        `SELECT d.member_id, d.day, d.active_seconds,
                pr.rate AS rate, pr.type AS rate_type, pr.currency AS currency
         FROM daily_member_active_seconds d
         LEFT JOIN pay_rates pr ON pr.member_id = d.member_id
         WHERE d.day >= $1 AND d.day <= $2
           AND ($3::uuid[] IS NULL OR d.member_id = ANY($3::uuid[]))
         ORDER BY d.day ASC`,
        [fromDay, toDay, memberIds],
      );
  return rows.map((r) => ({
    memberId: r.member_id,
    day: toDayString(r.day),
    activeSeconds: Math.max(0, Number(r.active_seconds) || 0),
    rate: Math.max(0, Number(r.rate) || 0),
    rateType: r.rate_type || "hourly",
    currency: r.currency || "USD",
  }));
}

/**
 * Raw per-session rows (start/stop granularity) - backs Work Sessions.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getWorkSessionRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await query(
    `SELECT s.id, s.member_id, s.task_id, s.project_id,
            COALESCE(t.title, '') AS task_title, COALESCE(p.name, '') AS project_name,
            s.started_at, s.ended_at, s.active_seconds, s.idle_seconds, s.source
     FROM activity_sessions s
     LEFT JOIN tasks t ON t.id = s.task_id
     LEFT JOIN projects p ON p.id = s.project_id
     WHERE s.started_at >= $1 AND s.started_at < $2
       AND ($3::uuid[] IS NULL OR s.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR s.project_id = ANY($4::uuid[]))
     ORDER BY s.started_at DESC
     LIMIT 2000`,
    [from.toISOString(), to.toISOString(), memberIds, projectIds],
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    taskId: r.task_id,
    projectId: r.project_id,
    taskTitle: r.task_title,
    projectName: r.project_name,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeSeconds: Math.max(0, Number(r.active_seconds) || 0),
    idleSeconds: Math.max(0, Number(r.idle_seconds) || 0),
    source: r.source,
  }));
}

/**
 * Real change history - backs the Audit Log report. Every insert/update/delete
 * on members/roles/etc already lands here via fn_audit_log_trigger(); this is
 * the first reader of it for a report (see ensure-lookup-schema.js trg_audit_*).
 * @param {{ fromDay: string, toDay: string, limit?: number }} params
 */
export async function getAuditLogRowsPg({ fromDay, toDay, limit = 500 }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await query(
    `SELECT a.id, a.table_name, a.record_id, a.action, a.old_data, a.new_data,
            a.performed_by, a.created_at, m.display_name AS performed_by_name
     FROM audit_logs a
     LEFT JOIN members m ON m.id = a.performed_by
     WHERE a.created_at >= $1 AND a.created_at < $2
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [from.toISOString(), to.toISOString(), Math.min(Math.max(limit, 1), 2000)],
  );
  return rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    recordId: r.record_id,
    action: r.action,
    oldData: r.old_data,
    newData: r.new_data,
    performedBy: r.performed_by,
    performedByName: r.performed_by_name || "System",
    createdAt: r.created_at,
  }));
}

/**
 * Per-member weekly/daily limit vs. seconds actually tracked in [fromDay,
 * toDay] - backs both Weekly Limits and Daily Limits (caller passes the week
 * or day window; `limits` carries both thresholds on the same row).
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getLimitsUsageRowsPg({ memberIds, fromDay, toDay }) {
  const rows = await query(
    `SELECT l.member_id, l.weekly, l.daily,
            COALESCE(SUM(d.active_seconds), 0) AS period_seconds
     FROM limits l
     LEFT JOIN daily_member_active_seconds d
       ON d.member_id = l.member_id AND d.day >= $1 AND d.day <= $2
     WHERE ($3::uuid[] IS NULL OR l.member_id = ANY($3::uuid[]))
     GROUP BY l.member_id, l.weekly, l.daily`,
    [fromDay, toDay, memberIds],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    weeklyLimitHours: Number(r.weekly) || 0,
    dailyLimitHours: Number(r.daily) || 0,
    periodSeconds: Math.max(0, Number(r.period_seconds) || 0),
  }));
}

/**
 * Real submitted/approved/rejected timesheet rows - backs Timesheet Approvals.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getTimesheetApprovalRowsPg({ memberIds, fromDay, toDay }) {
  const rows = await query(
    `SELECT t.id, t.member_id, t.period_start, t.period_end, t.status,
            t.total_hours, t.billable_hours, t.submitted_at, t.approved_at, t.approved_by
     FROM timesheets t
     WHERE t.period_start <= $2 AND t.period_end >= $1
       AND ($3::uuid[] IS NULL OR t.member_id = ANY($3::uuid[]))
     ORDER BY t.period_start DESC
     LIMIT 500`,
    [fromDay, toDay, memberIds],
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    periodStart: toDayString(r.period_start),
    periodEnd: toDayString(r.period_end),
    status: r.status,
    totalHours: r.total_hours == null ? 0 : Number(r.total_hours),
    billableHours: r.billable_hours == null ? 0 : Number(r.billable_hours),
    submittedAt: r.submitted_at,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
  }));
}

/**
 * Per-member total seconds by app, over [fromDay, toDay] - backs the "Apps"
 * side of the Apps & URLs report. Grouped server-side (activity_app_logs can
 * run to thousands of 30s-granularity rows per member per day).
 * `projectIds` narrows to logs tied to a task in one of those projects (the
 * same task_id -> tasks.project_id join getManualTimeEditRowsPg uses) - a log
 * with no task_id is excluded when a project filter is active.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, projectIds?: string[] | null }} params
 */
export async function getAppUsageRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await query(
    `SELECT l.member_id, a.name AS app_name, SUM(l.duration_seconds) AS total_seconds
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.started_at >= $1 AND l.started_at < $2
       AND ($3::uuid[] IS NULL OR l.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR t.project_id = ANY($4::uuid[]))
     GROUP BY l.member_id, a.name
     ORDER BY total_seconds DESC
     LIMIT 500`,
    [from.toISOString(), to.toISOString(), memberIds, projectIds],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    appName: r.app_name,
    totalSeconds: Math.max(0, Number(r.total_seconds) || 0),
  }));
}

/**
 * Per-member total seconds by domain, over [fromDay, toDay] - the "URLs" side
 * of the Apps & URLs report. `projectIds` narrows the same way getAppUsageRowsPg
 * does, via the log's task_id -> tasks.project_id.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, projectIds?: string[] | null }} params
 */
export async function getUrlUsageRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await query(
    `SELECT l.member_id, l.domain, SUM(l.duration_seconds) AS total_seconds
     FROM activity_url_logs l
     LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.visited_at >= $1 AND l.visited_at < $2
       AND l.domain <> ''
       AND ($3::uuid[] IS NULL OR l.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR t.project_id = ANY($4::uuid[]))
     GROUP BY l.member_id, l.domain
     ORDER BY total_seconds DESC
     LIMIT 500`,
    [from.toISOString(), to.toISOString(), memberIds, projectIds],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    domain: r.domain,
    totalSeconds: Math.max(0, Number(r.total_seconds) || 0),
  }));
}

/**
 * Manual time entries in a period - backs the Manual Time Edits report.
 *
 * `source` defaults to 'manual' on time_entries, and the tracker writes
 * 'tracked' rows, so this is exactly the set a person typed in by hand rather
 * than had recorded for them. created_by/updated_by are VARCHAR (they hold a
 * member id for in-app writes), resolved to names by the caller.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, projectIds?: string[] | null }} params
 */
export async function getManualTimeEditRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const rows = await query(
    `SELECT te.id, te.member_id, te.project_id, te.task_id, te.date,
            te.start_time, te.end_time, te.duration, te.description,
            te.billable, te.status, te.created_by, te.updated_by,
            te.created_at, te.updated_at,
            COALESCE(p.name, '') AS project_name,
            COALESCE(t.title, '') AS task_title
     FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     LEFT JOIN tasks t ON t.id = te.task_id
     WHERE te.source = 'manual'
       AND te.date >= $1 AND te.date <= $2
       AND ($3::uuid[] IS NULL OR te.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR te.project_id = ANY($4::uuid[]))
     ORDER BY te.date DESC, te.created_at DESC
     LIMIT 2000`,
    [fromDay, toDay, memberIds, projectIds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    memberId: r.member_id,
    projectId: r.project_id,
    projectName: r.project_name,
    taskTitle: r.task_title,
    day: toDayString(r.date),
    startTime: r.start_time ? String(r.start_time) : "",
    endTime: r.end_time ? String(r.end_time) : "",
    durationSeconds: Math.max(0, Number(r.duration) || 0),
    description: r.description || "",
    billable: r.billable === true,
    status: r.status || "pending",
    createdBy: r.created_by || "",
    updatedBy: r.updated_by || "",
    editedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

/**
 * Work breaks, derived from the gaps between a member's consecutive tracked
 * sessions on the same local day.
 *
 * There is no breaks table and nothing records "went on break" - but a gap
 * between the end of one session and the start of the next IS the break, so
 * it is derived rather than invented. Gaps shorter than minGapMinutes are
 * noise (a stop/start while switching task), and a gap that crosses into the
 * next day is the end of the working day, not a break, so it is excluded.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, minGapMinutes?: number }} params
 */
export async function getWorkBreakRowsPg({ memberIds, fromDay, toDay, minGapMinutes = 5 }) {
  const rows = await query(
    `WITH tz AS (
       SELECT s.id, s.member_id, s.started_at, s.ended_at,
              COALESCE(NULLIF(m.timezone, ''), 'UTC') AS zone
       FROM activity_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       WHERE s.ended_at IS NOT NULL
         AND ($3::uuid[] IS NULL OR s.member_id = ANY($3::uuid[]))
     ),
     local_days AS (
       SELECT id, member_id, started_at, ended_at,
              (started_at AT TIME ZONE zone)::date AS local_day,
              (ended_at   AT TIME ZONE zone)::date AS end_local_day
       FROM tz
     ),
     bounded AS (
       SELECT * FROM local_days WHERE local_day >= $1 AND local_day <= $2
     ),
     gaps AS (
       SELECT member_id, local_day, ended_at AS break_start,
              LEAD(started_at) OVER (PARTITION BY member_id, local_day ORDER BY started_at) AS break_end
       FROM bounded
     )
     SELECT member_id, local_day, break_start, break_end,
            EXTRACT(EPOCH FROM (break_end - break_start)) AS gap_seconds
     FROM gaps
     WHERE break_end IS NOT NULL
       AND break_end > break_start
       AND EXTRACT(EPOCH FROM (break_end - break_start)) >= $4
     ORDER BY local_day DESC, break_start DESC
     LIMIT 2000`,
    [fromDay, toDay, memberIds, Math.max(1, minGapMinutes) * 60],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    day: toDayString(r.local_day),
    startedAt: r.break_start ? new Date(r.break_start).toISOString() : null,
    endedAt: r.break_end ? new Date(r.break_end).toISOString() : null,
    durationSeconds: Math.max(0, Math.round(Number(r.gap_seconds) || 0)),
  }));
}

/**
 * Shift attendance: did people work on the days they were scheduled to?
 *
 * There is no shift table and no configured shift clock times anywhere in this
 * schema, so "late" and "abandoned" are not derivable and are deliberately not
 * invented. What IS configured is time_settings.work_days - a per-member array
 * of weekday indices where 0 = Monday (its default [0,1,2,3,4] is Mon-Fri, and
 * the settings UI labels it that way). Postgres ISODOW is 1=Monday, hence the
 * -1 below.
 *
 * Attendance is that schedule crossed with whether the member actually tracked
 * anything that day, bucketed in their own timezone so a late-evening session
 * counts towards the day they worked it:
 *   worked      - scheduled, and tracked time
 *   missed      - scheduled, tracked nothing
 *   unscheduled - not scheduled, but tracked time anyway
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getShiftAttendanceRowsPg({ memberIds, fromDay, toDay }) {
  const rows = await query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
     ),
     scoped_members AS (
       SELECT m.id,
              COALESCE(NULLIF(m.timezone, ''), 'UTC') AS zone,
              COALESCE(ts.work_days, '[0,1,2,3,4]'::jsonb) AS work_days
       FROM members m
       LEFT JOIN time_settings ts ON ts.member_id = m.id
       WHERE m.status <> 'banned'
         AND ($3::uuid[] IS NULL OR m.id = ANY($3::uuid[]))
     ),
     worked AS (
       SELECT s.member_id,
              (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date AS day,
              SUM(s.active_seconds) AS active_seconds
       FROM activity_sessions s
       JOIN members m ON m.id = s.member_id
       GROUP BY 1, 2
     )
     SELECT sm.id AS member_id,
            d.day,
            (sm.work_days @> to_jsonb(EXTRACT(ISODOW FROM d.day)::int - 1)) AS scheduled,
            COALESCE(w.active_seconds, 0) AS active_seconds
     FROM scoped_members sm
     CROSS JOIN days d
     LEFT JOIN worked w ON w.member_id = sm.id AND w.day = d.day
     WHERE (sm.work_days @> to_jsonb(EXTRACT(ISODOW FROM d.day)::int - 1))
        OR COALESCE(w.active_seconds, 0) > 0
     ORDER BY d.day DESC
     LIMIT 3000`,
    [fromDay, toDay, memberIds],
  );
  return rows.map((r) => {
    const activeSeconds = Math.max(0, Number(r.active_seconds) || 0);
    const scheduled = r.scheduled === true;
    return {
      memberId: String(r.member_id),
      day: toDayString(r.day),
      scheduled,
      activeSeconds,
      status: scheduled ? (activeSeconds > 0 ? "worked" : "missed") : "unscheduled",
    };
  });
}
