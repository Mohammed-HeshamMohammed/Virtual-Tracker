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
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getMemberDailyAmountRowsPg({ memberIds, fromDay, toDay }) {
  const rows = await query(
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
export async function getWorkSessionRowsPg({ memberIds, fromDay, toDay }) {
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
     ORDER BY s.started_at DESC
     LIMIT 2000`,
    [from.toISOString(), to.toISOString(), memberIds],
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
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getAppUsageRowsPg({ memberIds, fromDay, toDay }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await query(
    `SELECT l.member_id, a.name AS app_name, SUM(l.duration_seconds) AS total_seconds
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     WHERE l.started_at >= $1 AND l.started_at < $2
       AND ($3::uuid[] IS NULL OR l.member_id = ANY($3::uuid[]))
     GROUP BY l.member_id, a.name
     ORDER BY total_seconds DESC
     LIMIT 500`,
    [from.toISOString(), to.toISOString(), memberIds],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    appName: r.app_name,
    totalSeconds: Math.max(0, Number(r.total_seconds) || 0),
  }));
}

/**
 * Per-member total seconds by domain, over [fromDay, toDay] - the "URLs" side
 * of the Apps & URLs report.
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string }} params
 */
export async function getUrlUsageRowsPg({ memberIds, fromDay, toDay }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await query(
    `SELECT member_id, domain, SUM(duration_seconds) AS total_seconds
     FROM activity_url_logs
     WHERE visited_at >= $1 AND visited_at < $2
       AND domain <> ''
       AND ($3::uuid[] IS NULL OR member_id = ANY($3::uuid[]))
     GROUP BY member_id, domain
     ORDER BY total_seconds DESC
     LIMIT 500`,
    [from.toISOString(), to.toISOString(), memberIds],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    domain: r.domain,
    totalSeconds: Math.max(0, Number(r.total_seconds) || 0),
  }));
}
