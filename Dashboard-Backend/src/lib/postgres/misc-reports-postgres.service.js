import { isSensitiveFieldName } from "../../http/sensitive-fields.js";
import { query } from "./client.js";

/**
 * Splits an over-fetched result into the page the caller asked for and the
 * fact that there was more.
 *
 * Every report caps how many rows it will read, and until now each one hit its
 * cap silently - the table just showed a shorter total, which looks like an
 * answer rather than a missing one. Each query asks for `limit + 1` rows so
 * "there is more" can be reported without a second COUNT.
 */
export function withTruncation(rows, limit) {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

function toDayString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export async function getMemberDailyAmountRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const hasProjectFilter = Array.isArray(projectIds) && projectIds.length > 0;
  const rows = hasProjectFilter
    ? await query(
        `SELECT dt.member_id, dt.day, SUM(dt.active_seconds) AS active_seconds,
                MIN(COALESCE(h.rate, pr.rate)) AS rate,
                MIN(COALESCE(h.type, pr.type)) AS rate_type,
                MIN(COALESCE(h.currency, pr.currency)) AS currency
         FROM daily_member_task_active_seconds dt
         JOIN tasks t ON t.id = dt.task_id
         LEFT JOIN pay_rates pr ON pr.member_id = dt.member_id
         LEFT JOIN LATERAL (
           SELECT rate, type, currency FROM pay_rate_history
           WHERE member_id = dt.member_id AND effective_date <= dt.day
           ORDER BY effective_date DESC, created_at DESC LIMIT 1
         ) h ON true
         WHERE dt.day >= $1 AND dt.day <= $2
           AND ($3::uuid[] IS NULL OR dt.member_id = ANY($3::uuid[]))
           AND t.project_id = ANY($4::uuid[])
         GROUP BY dt.member_id, dt.day
         ORDER BY dt.day ASC`,
        [fromDay, toDay, memberIds, projectIds],
      )
    : await query(
        `SELECT d.member_id, d.day, d.active_seconds,
                COALESCE(h.rate, pr.rate) AS rate,
                COALESCE(h.type, pr.type) AS rate_type,
                COALESCE(h.currency, pr.currency) AS currency
         FROM daily_member_active_seconds d
         LEFT JOIN pay_rates pr ON pr.member_id = d.member_id
         LEFT JOIN LATERAL (
           SELECT rate, type, currency FROM pay_rate_history
           WHERE member_id = d.member_id AND effective_date <= d.day
           ORDER BY effective_date DESC, created_at DESC LIMIT 1
         ) h ON true
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

export async function getWorkSessionRowsPg({ memberIds, fromDay, toDay, projectIds = null, limit = 2000 }) {
  // Widened by a day either side, exactly like the Time & Activity query:
  // a session belongs to the local day it started in the MEMBER's zone, and
  // that day can sit outside the same dates expressed in UTC. A member at
  // UTC-6 starting 8pm on the 9th is 02:00 UTC on the 10th - a UTC-exact
  // window dropped their evening entirely. The caller re-filters on the
  // member-local day, so over-fetching here is what makes that possible.
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 2);

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
     LIMIT $5`,
    [from.toISOString(), to.toISOString(), memberIds, projectIds, limit + 1],
  );
  const page = withTruncation(rows, limit);
  return {
    truncated: page.truncated,
    rows: page.rows.map((r) => ({
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
    })),
  };
}

/**
 * Audit rows for the report.
 *
 * `memberIds` is the viewer's visible scope. Rows on the `members` table carry
 * that member's id as `record_id`, so they are filtered to the scope; rows on
 * org-wide configuration (`roles`) are not member-specific and stay. Before
 * this, any management role - including a plain Manager who can normally see
 * only their own reports - got every audit row in the organisation, complete
 * with the full `to_jsonb(OLD)`/`to_jsonb(NEW)` snapshot of every member
 * record. The report itself rendered none of that, but it was in the response.
 */
export async function getAuditLogRowsPg({ fromDay, toDay, memberIds = null, limit = 500 }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  const capped = Math.min(Math.max(limit, 1), 2000);

  const rows = await query(
    `SELECT a.id, a.table_name, a.record_id, a.action, a.old_data, a.new_data,
            a.performed_by, a.created_at,
            m.display_name AS performed_by_name,
            subject.display_name AS subject_name
     FROM audit_logs a
     LEFT JOIN members m ON m.id = a.performed_by
     LEFT JOIN members subject ON subject.id = a.record_id AND a.table_name = 'members'
     WHERE a.created_at >= $1 AND a.created_at < $2
       AND ($4::uuid[] IS NULL
            OR a.table_name <> 'members'
            OR a.record_id = ANY($4::uuid[]))
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [from.toISOString(), to.toISOString(), capped + 1, memberIds],
  );

  const truncated = rows.length > capped;
  return {
    truncated,
    rows: rows.slice(0, capped).map((r) => ({
      id: r.id,
      tableName: r.table_name,
      recordId: r.record_id,
      action: r.action,
      // `changes` replaces the raw old_data/new_data snapshots: it is what the
      // report actually needs ("which fields moved, and to what"), and it does
      // not put a full copy of every member record on the wire.
      changes: summarizeAuditChange(r.action, r.old_data, r.new_data),
      performedBy: r.performed_by,
      performedByName: r.performed_by_name || "System",
      subjectName: r.subject_name || "",
      createdAt: r.created_at,
    })),
  };
}

/** Columns that say nothing about intent and would drown the real change. */
const AUDIT_NOISE_FIELDS = new Set(["updated_at", "created_at", "updated_by", "created_by"]);

/**
 * The fields an INSERT/UPDATE/DELETE actually moved, as
 * `{ field, from, to }`, with anything secret-shaped redacted. Capped, because
 * one row should summarise a change rather than reproduce a record.
 */
export function summarizeAuditChange(action, oldData, newData, maxFields = 12) {
  const before = oldData && typeof oldData === "object" ? oldData : {};
  const after = newData && typeof newData === "object" ? newData : {};
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);

  const changes = [];
  for (const field of fields) {
    if (AUDIT_NOISE_FIELDS.has(field)) continue;
    const from = before[field];
    const to = after[field];
    if (action === "UPDATE" && JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({
      field,
      from: presentAuditValue(field, from),
      to: presentAuditValue(field, to),
    });
    if (changes.length >= maxFields) break;
  }
  return changes;
}

function presentAuditValue(field, value) {
  if (value === undefined || value === null) return null;
  if (isSensitiveFieldName(field)) return "[REDACTED]";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * The configured limits, and the member-local daily totals they are measured
 * against, kept separate.
 *
 * This used to be one query that summed every day in the range into a single
 * `period_seconds` - which is only meaningful when the range happens to be
 * exactly one period long. The daily rows come back unaggregated now so the
 * caller can bucket them into the week or day the limit is actually about
 * (see modules/reports/build-limit-usage-rows.js).
 */
export async function getLimitsUsageRowsPg({ memberIds, fromDay, toDay }) {
  const [limits, usage] = await Promise.all([
    query(
      `SELECT l.member_id, l.weekly, l.daily
       FROM limits l
       WHERE ($1::uuid[] IS NULL OR l.member_id = ANY($1::uuid[]))`,
      [memberIds],
    ),
    query(
      // Widened to whole weeks either side so a week clipped by the range is
      // still measured against the hours actually worked in it, rather than
      // looking compliant because two of its days fell outside the window.
      `SELECT d.member_id, d.day, d.active_seconds
       FROM daily_member_active_seconds d
       WHERE d.day >= ($1::date - 7) AND d.day <= ($2::date + 7)
         AND ($3::uuid[] IS NULL OR d.member_id = ANY($3::uuid[]))
       ORDER BY d.day ASC`,
      [fromDay, toDay, memberIds],
    ),
  ]);

  return {
    limitRows: limits.map((r) => ({
      memberId: String(r.member_id),
      weeklyLimitHours: Number(r.weekly) || 0,
      dailyLimitHours: Number(r.daily) || 0,
    })),
    usageRows: usage.map((r) => ({
      memberId: String(r.member_id),
      day: toDayString(r.day),
      activeSeconds: Math.max(0, Number(r.active_seconds) || 0),
    })),
  };
}

export async function getTimesheetPeriodAmountRowsPg({ memberId, fromDay, toDay }) {
  const rows = await query(
    `WITH worked AS (
       SELECT date AS day, project_id, duration AS seconds, billable
       FROM time_entries
       WHERE member_id = $1 AND date BETWEEN $2 AND $3 AND status != 'rejected'
       UNION ALL
       SELECT started_at::date AS day, project_id, active_seconds AS seconds, true AS billable
       FROM activity_sessions
       WHERE member_id = $1 AND started_at::date BETWEEN $2 AND $3
     ),
     by_day_project AS (
       SELECT day, project_id, SUM(seconds) AS seconds,
              SUM(CASE WHEN billable THEN seconds ELSE 0 END) AS billable_seconds
       FROM worked
       GROUP BY day, project_id
     )
     SELECT bdp.day, bdp.project_id, COALESCE(p.name, '') AS project_name,
            bdp.seconds, bdp.billable_seconds,
            COALESCE(h.rate, pr.rate, 0) AS rate,
            COALESCE(h.currency, pr.currency, 'USD') AS currency
     FROM by_day_project bdp
     LEFT JOIN projects p ON p.id = bdp.project_id
     LEFT JOIN pay_rates pr ON pr.member_id = $1
     LEFT JOIN LATERAL (
       SELECT rate, currency FROM pay_rate_history
       WHERE member_id = $1 AND effective_date <= bdp.day
       ORDER BY effective_date DESC, created_at DESC LIMIT 1
     ) h ON true
     ORDER BY bdp.day ASC`,
    [memberId, fromDay, toDay],
  );
  return rows.map((r) => ({
    day: toDayString(r.day),
    projectId: r.project_id,
    projectName: r.project_name || "",
    seconds: Math.max(0, Number(r.seconds) || 0),
    billableSeconds: Math.max(0, Number(r.billable_seconds) || 0),
    rate: Math.max(0, Number(r.rate) || 0),
    currency: r.currency || "USD",
  }));
}

export async function getTimesheetApprovalRowsPg({ memberIds, fromDay, toDay, limit = 500 }) {
  const rows = await query(
    `SELECT t.id, t.member_id, t.period_start, t.period_end, t.status,
            t.total_hours, t.billable_hours, t.submitted_at, t.approved_at, t.approved_by
     FROM timesheets t
     WHERE t.period_start <= $2 AND t.period_end >= $1
       AND ($3::uuid[] IS NULL OR t.member_id = ANY($3::uuid[]))
     ORDER BY t.period_start DESC
     LIMIT $4`,
    [fromDay, toDay, memberIds, limit + 1],
  );
  const page = withTruncation(rows, limit);
  return {
    truncated: page.truncated,
    rows: page.rows.map((r) => ({
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
    })),
  };
}

/** Member-local calendar day of a timestamp column. `m_tz` must be in scope. */
function localDay(tsColumn) {
  return `(${tsColumn} AT TIME ZONE COALESCE(NULLIF(m_tz.timezone, ''), 'UTC'))::date`;
}

/**
 * Raw foreground slices for the Apps & URLs report.
 *
 * Two things changed here and they are connected.
 *
 * 1. **The member's calendar, not UTC.** This used to window on
 *    `started_at >= fromDay 00:00Z AND < toDay+1 00:00Z`, so a member at
 *    UTC-6 got a report running 6pm to 6pm - disagreeing with Time & Activity,
 *    Work Sessions and Work Breaks about the very same seconds. Every other
 *    report that reads agent data buckets in the member's own zone; this one
 *    now does too.
 *
 * 2. **Rows, not sums.** It used to `SUM(...) GROUP BY app_name`, which forced
 *    the report to describe browsing as "Google Chrome" - a container, not an
 *    activity - and left it unable to say whether any of it was productive.
 *    Returning the slices lets the caller resolve each one through
 *    `category-resolver`, the same module the Activity tab and focused time
 *    use, so all four finally agree by construction.
 *
 * `page_title` and `session_id` come along because the resolver needs them to
 * work out which site a browser slice was actually on.
 */
export async function getAppLogSlicesPg({ memberIds, fromDay, toDay, projectIds = null, limit = 50000 }) {
  const rows = await query(
    `SELECT l.member_id, l.session_id, a.name AS app_name, l.page_title,
            l.started_at, l.duration_seconds
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     LEFT JOIN members m_tz ON m_tz.id = l.member_id
     LEFT JOIN tasks t ON t.id = l.task_id
     WHERE ${localDay("l.started_at")} >= $1::date
       AND ${localDay("l.started_at")} <= $2::date
       AND ($3::uuid[] IS NULL OR l.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR t.project_id = ANY($4::uuid[]))
     ORDER BY l.started_at
     LIMIT $5`,
    [fromDay, toDay, memberIds, projectIds, limit],
  );
  return rows.map((r) => ({
    member_id: String(r.member_id),
    session_id: r.session_id ? String(r.session_id) : "",
    app_name: r.app_name || "",
    page_title: r.page_title || "",
    started_at: r.started_at,
    duration_seconds: Math.max(0, Number(r.duration_seconds) || 0),
  }));
}

/**
 * URL slices for the same range. These are an *index* of which site was open
 * when - never a second source of seconds. Summing them alongside the app
 * slices above is what made focused time report roughly double a browsing
 * member's day (see modules/classification/focused-time.js).
 */
export async function getUrlLogSlicesPg({ memberIds, fromDay, toDay, projectIds = null, limit = 50000 }) {
  const rows = await query(
    `SELECT l.member_id, l.session_id, l.domain, l.visited_at, l.duration_seconds
     FROM activity_url_logs l
     LEFT JOIN members m_tz ON m_tz.id = l.member_id
     LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.domain IS NOT NULL AND l.domain <> ''
       AND ${localDay("l.visited_at")} >= $1::date
       AND ${localDay("l.visited_at")} <= $2::date
       AND ($3::uuid[] IS NULL OR l.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR t.project_id = ANY($4::uuid[]))
     ORDER BY l.visited_at
     LIMIT $5`,
    [fromDay, toDay, memberIds, projectIds, limit],
  );
  return rows.map((r) => ({
    member_id: String(r.member_id),
    session_id: r.session_id ? String(r.session_id) : "",
    domain: r.domain || "",
    visited_at: r.visited_at,
    duration_seconds: Math.max(0, Number(r.duration_seconds) || 0),
  }));
}

export async function getManualTimeEditRowsPg({ memberIds, fromDay, toDay, projectIds = null, limit = 2000 }) {
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
     LIMIT $5`,
    [fromDay, toDay, memberIds, projectIds, limit + 1],
  );
  const page = withTruncation(rows, limit);
  return {
    truncated: page.truncated,
    rows: page.rows.map((r) => ({
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
    })),
  };
}

export async function getWorkBreakRowsPg({ memberIds, fromDay, toDay, minGapMinutes = 5, limit = 2000 }) {
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
     LIMIT $5`,
    [fromDay, toDay, memberIds, Math.max(1, minGapMinutes) * 60, limit + 1],
  );
  const page = withTruncation(rows, limit);
  return {
    truncated: page.truncated,
    rows: page.rows.map((r) => ({
    memberId: r.member_id,
    day: toDayString(r.local_day),
    startedAt: r.break_start ? new Date(r.break_start).toISOString() : null,
    endedAt: r.break_end ? new Date(r.break_end).toISOString() : null,
    durationSeconds: Math.max(0, Math.round(Number(r.gap_seconds) || 0)),
    })),
  };
}

/**
 * Attendance against each member's configured working days.
 *
 * Three things were wrong before.
 *
 * 1. **It rescanned all of history on every request.** The `worked` CTE
 *    aggregated the whole of `activity_sessions` - no date bound, no member
 *    bound - and then threw away everything outside the range. That cost grew
 *    with the table forever, for a report that only ever looks at a few weeks.
 *
 * 2. **Approved absence was reported as a no-show.** A member on approved
 *    leave, or one whose missed day already has an agreed makeup day, was
 *    indistinguishable from someone who simply did not turn up.
 *
 * 3. **An agreed makeup day was reported as unscheduled.** Working an approved
 *    Saturday to cover a missed Tuesday showed up as time nobody asked for.
 *
 * There is no shift table in this schema - no start or end times anywhere - so
 * this cannot report lateness or an abandoned shift, and does not pretend to.
 * What it can say is whether a day was expected, whether anything was tracked,
 * and whether an empty expected day was excused.
 */
export async function getShiftAttendanceRowsPg({ memberIds, fromDay, toDay, limit = 3000 }) {
  const capped = Math.min(Math.max(limit, 1), 5000);
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
       -- Bounded to the requested range, widened a day either side because a
       -- member-local day straddles the same dates expressed in UTC.
       WHERE s.started_at >= ($1::date - 1) AND s.started_at < ($2::date + 2)
         AND ($3::uuid[] IS NULL OR s.member_id = ANY($3::uuid[]))
       GROUP BY 1, 2
     ),
     on_leave AS (
       SELECT r.member_id, d.day
       FROM time_off_requests r
       JOIN days d ON d.day BETWEEN r.start_date AND r.end_date
       WHERE r.status = 'approved'
         AND ($3::uuid[] IS NULL OR r.member_id = ANY($3::uuid[]))
     ),
     makeup_for AS (
       -- A missed day with an agreed makeup is excused, not a no-show.
       SELECT member_id, missed_date AS day FROM member_makeup_days
       WHERE missed_date BETWEEN $1::date AND $2::date
         AND ($3::uuid[] IS NULL OR member_id = ANY($3::uuid[]))
     ),
     makeup_on AS (
       -- ...and the day agreed to cover it is expected work.
       SELECT member_id, makeup_date AS day FROM member_makeup_days
       WHERE makeup_date BETWEEN $1::date AND $2::date
         AND ($3::uuid[] IS NULL OR member_id = ANY($3::uuid[]))
     )
     SELECT sm.id AS member_id,
            d.day,
            (sm.work_days @> to_jsonb(EXTRACT(ISODOW FROM d.day)::int - 1)) AS working_day,
            (mo.member_id IS NOT NULL) AS makeup_day,
            (ol.member_id IS NOT NULL) AS on_leave,
            (mf.member_id IS NOT NULL) AS makeup_agreed,
            COALESCE(w.active_seconds, 0) AS active_seconds
     FROM scoped_members sm
     CROSS JOIN days d
     LEFT JOIN worked    w  ON w.member_id  = sm.id AND w.day  = d.day
     LEFT JOIN on_leave  ol ON ol.member_id = sm.id AND ol.day = d.day
     LEFT JOIN makeup_for mf ON mf.member_id = sm.id AND mf.day = d.day
     LEFT JOIN makeup_on  mo ON mo.member_id = sm.id AND mo.day = d.day
     WHERE (sm.work_days @> to_jsonb(EXTRACT(ISODOW FROM d.day)::int - 1))
        OR mo.member_id IS NOT NULL
        OR COALESCE(w.active_seconds, 0) > 0
     ORDER BY d.day DESC
     LIMIT $4`,
    [fromDay, toDay, memberIds, capped + 1],
  );

  const truncated = rows.length > capped;
  return {
    truncated,
    rows: rows.slice(0, capped).map((r) => {
      const activeSeconds = Math.max(0, Number(r.active_seconds) || 0);
      const scheduled = r.working_day === true || r.makeup_day === true;
      return {
        memberId: String(r.member_id),
        day: toDayString(r.day),
        scheduled,
        makeupDay: r.makeup_day === true,
        activeSeconds,
        status: resolveAttendanceStatus({
          scheduled,
          worked: activeSeconds > 0,
          onLeave: r.on_leave === true,
          makeupAgreed: r.makeup_agreed === true,
        }),
      };
    }),
  };
}

/**
 * Pure so the rules are readable in one place and testable without a database.
 * Order matters: a day that was worked is "worked" whatever else was true of
 * it - someone who tracked time while nominally on leave did the work.
 */
export function resolveAttendanceStatus({ scheduled, worked, onLeave, makeupAgreed }) {
  if (worked) return scheduled ? "worked" : "unscheduled";
  if (!scheduled) return "unscheduled";
  if (onLeave) return "time-off";
  if (makeupAgreed) return "excused";
  return "missed";
}
