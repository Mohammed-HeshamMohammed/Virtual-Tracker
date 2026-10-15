import { query } from "./client.js";

export async function getTimeAndActivityReportRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const rows = await query(
    `SELECT
       s.member_id,
       s.task_id,
       s.project_id,
       COALESCE(t.title, '')  AS task_title,
       COALESCE(p.name, '')   AS project_name,
       p.client_hourly_rate,
       p.client_rate_currency,
       COALESCE(client_lookup.client_name, '') AS client_name,
       ci.net_terms_days AS client_net_terms_days,
       ci.tax_rate       AS client_tax_rate,
       ci.notes          AS client_billing_notes,
       COALESCE(team_lookup.team_name, '')     AS team_name,
       s.started_at,
       s.ended_at,
       s.updated_at,
       s.active_seconds,
       s.idle_seconds,
       shots.activity_sum,
       shots.activity_count
     FROM activity_sessions s
     LEFT JOIN tasks t ON t.id = s.task_id
     LEFT JOIN projects p ON p.id = s.project_id
     -- A project can carry more than one client row (client_projects has no
     -- per-project uniqueness); "group by client" only needs one label per
     -- project, so this takes the earliest-assigned link rather than
     -- fanning the report out into duplicate rows per extra client.
     LEFT JOIN LATERAL (
       SELECT c.id AS client_id, c.name AS client_name
       FROM client_projects cp
       JOIN clients c ON c.id = cp.client_id
       WHERE cp.project_id = p.id
       ORDER BY cp.assigned_at ASC
       LIMIT 1
     ) client_lookup ON p.id IS NOT NULL
     -- The client's own invoice terms, when it has set any: a statement uses
     -- them for tax and the due date, the way its invoices do.
     LEFT JOIN client_invoicing ci
       ON ci.client_id = client_lookup.client_id AND ci.custom_for_client = true
     -- Same reasoning for a member on more than one team.
     LEFT JOIN LATERAL (
       SELECT tm_t.name AS team_name
       FROM team_members tm
       JOIN teams tm_t ON tm_t.id = tm.team_id
       WHERE tm.member_id = s.member_id
       ORDER BY tm.joined_at ASC
       LIMIT 1
     ) team_lookup ON true
     -- Activity is the screenshots' activity levels (as corrected by a manager),
     -- the same figure the Screenshots, Apps and URLs pages show. Summed with a
     -- count rather than averaged here, so any grouping of rows averages right.
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(sc.activity_level), 0) AS activity_sum, COUNT(*) AS activity_count
       FROM activity_screenshots sc
       WHERE sc.session_id = s.id::text
     ) shots ON true
     WHERE s.started_at >= $1 AND s.started_at < $2
       AND ($3::uuid[] IS NULL OR s.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR s.project_id = ANY($4::uuid[]))
     ORDER BY s.started_at ASC`,
    [from.toISOString(), to.toISOString(), memberIds, projectIds],
  );

  return rows.map((row) => ({
    member_id: row.member_id,
    task_id: row.task_id,
    project_id: row.project_id,
    task_title: row.task_title,
    project_name: row.project_name,
    client_hourly_rate: row.client_hourly_rate,
    client_rate_currency: row.client_rate_currency,
    client_net_terms_days: row.client_net_terms_days,
    client_tax_rate: row.client_tax_rate,
    client_billing_notes: row.client_billing_notes,
    client_name: row.client_name,
    team_name: row.team_name,
    started_at: row.started_at,
    ended_at: row.ended_at,
    updated_at: row.updated_at,
    active_seconds: Math.max(0, Number(row.active_seconds) || 0),
    idle_seconds: Math.max(0, Number(row.idle_seconds) || 0),
    activity_sum: Math.max(0, Number(row.activity_sum) || 0),
    activity_count: Math.max(0, Number(row.activity_count) || 0),
  }));
}

export async function getManualTimeEntryRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const rows = await query(
    `SELECT
       te.member_id,
       te.project_id,
       te.date,
       te.duration,
       COALESCE(p.name, '') AS project_name,
       p.client_hourly_rate,
       p.client_rate_currency,
       COALESCE(client_lookup.client_name, '') AS client_name,
       ci.net_terms_days AS client_net_terms_days,
       ci.tax_rate       AS client_tax_rate,
       ci.notes          AS client_billing_notes,
       COALESCE(team_lookup.team_name, '')     AS team_name
     FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     LEFT JOIN LATERAL (
       SELECT c.id AS client_id, c.name AS client_name
       FROM client_projects cp
       JOIN clients c ON c.id = cp.client_id
       WHERE cp.project_id = p.id
       ORDER BY cp.assigned_at ASC
       LIMIT 1
     ) client_lookup ON p.id IS NOT NULL
     LEFT JOIN client_invoicing ci
       ON ci.client_id = client_lookup.client_id AND ci.custom_for_client = true
     LEFT JOIN LATERAL (
       SELECT tm_t.name AS team_name
       FROM team_members tm
       JOIN teams tm_t ON tm_t.id = tm.team_id
       WHERE tm.member_id = te.member_id
       ORDER BY tm.joined_at ASC
       LIMIT 1
     ) team_lookup ON true
     WHERE te.source = 'manual'
       AND te.status = 'approved'
       AND te.date >= $1::date AND te.date <= $2::date
       AND ($3::uuid[] IS NULL OR te.member_id = ANY($3::uuid[]))
       AND ($4::uuid[] IS NULL OR te.project_id = ANY($4::uuid[]))
     ORDER BY te.date ASC
     LIMIT 5000`,
    [fromDay, toDay, memberIds, projectIds],
  );

  return rows.map((row) => ({
    member_id: row.member_id,
    project_id: row.project_id,
    // pg returns a DATE column as a JS Date, not a string - String(date) formats
    // it in the server's LOCAL timezone ("Mon Sep 28 2026 ..."), not as
    // YYYY-MM-DD, so slicing that gave "Mon Sep 28": always greater than any
    // real ISO day key by plain string comparison, so build-time-and-activity-
    // rows.js's `row.day > toDay` range check silently dropped every manual
    // entry, unconditionally. toISOString() first gives the actual UTC day.
    day: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
    project_name: row.project_name,
    client_hourly_rate: row.client_hourly_rate,
    client_rate_currency: row.client_rate_currency,
    client_net_terms_days: row.client_net_terms_days,
    client_tax_rate: row.client_tax_rate,
    client_billing_notes: row.client_billing_notes,
    client_name: row.client_name,
    team_name: row.team_name,
    manual_seconds: Math.max(0, Number(row.duration) || 0),
  }));
}
