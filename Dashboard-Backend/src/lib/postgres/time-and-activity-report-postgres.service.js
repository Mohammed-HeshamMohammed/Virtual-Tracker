// Raw per-session rows for the Time & Activity report (reports/time-and-activity).
// No day bucketing here - each activity_sessions row is one continuous session and
// can span midnight, so attributing it to a calendar day (in the member's own
// timezone, not the server's) has to happen after the fact, per-session, in
// build-time-and-activity-rows.js. Returns seconds, not formatted strings -
// features/reports/utils/time-and-activity/row-aggregate.ts owns that on the frontend.
import { query } from "./client.js";

/**
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, projectIds?: string[] | null }} params
 *   memberIds: null = no member filter (caller has already resolved visibility).
 *   projectIds: null/omitted = no project filter (caller has already narrowed via
 *   filterProjectIdsForViewer - this never widens scope on its own).
 *   fromDay/toDay: 'YYYY-MM-DD', the requested range in whatever local calendar the
 *   caller resolves per member. The query window here is widened by a day on each
 *   side so no session near a local-day edge gets excluded before that resolution
 *   happens - every real-world UTC offset (-12 to +14) fits inside one day of slack.
 * @returns {Promise<Array<{
 *   member_id: string,
 *   task_id: string | null,
 *   project_id: string | null,
 *   task_title: string,
 *   project_name: string,
 *   client_name: string,
 *   team_name: string,
 *   started_at: string,
 *   ended_at: string | null,
 *   updated_at: string,
 *   active_seconds: number,
 *   idle_seconds: number,
 * }>>}
 */
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
       COALESCE(client_lookup.client_name, '') AS client_name,
       COALESCE(team_lookup.team_name, '')     AS team_name,
       s.started_at,
       s.ended_at,
       s.updated_at,
       s.active_seconds,
       s.idle_seconds
     FROM activity_sessions s
     LEFT JOIN tasks t ON t.id = s.task_id
     LEFT JOIN projects p ON p.id = s.project_id
     -- A project can carry more than one client row (client_projects has no
     -- per-project uniqueness); "group by client" only needs one label per
     -- project, so this takes the earliest-assigned link rather than
     -- fanning the report out into duplicate rows per extra client.
     LEFT JOIN LATERAL (
       SELECT c.name AS client_name
       FROM client_projects cp
       JOIN clients c ON c.id = cp.client_id
       WHERE cp.project_id = p.id
       ORDER BY cp.assigned_at ASC
       LIMIT 1
     ) client_lookup ON p.id IS NOT NULL
     -- Same reasoning for a member on more than one team.
     LEFT JOIN LATERAL (
       SELECT tm_t.name AS team_name
       FROM team_members tm
       JOIN teams tm_t ON tm_t.id = tm.team_id
       WHERE tm.member_id = s.member_id
       ORDER BY tm.joined_at ASC
       LIMIT 1
     ) team_lookup ON true
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
    client_name: row.client_name,
    team_name: row.team_name,
    started_at: row.started_at,
    ended_at: row.ended_at,
    updated_at: row.updated_at,
    active_seconds: Math.max(0, Number(row.active_seconds) || 0),
    idle_seconds: Math.max(0, Number(row.idle_seconds) || 0),
  }));
}

/**
 * Manual time entries for the same window the session query above covers.
 *
 * These live in a different table for a good reason - a manual entry is an
 * assertion about time that was never observed, so it carries a duration but
 * no active/idle split and no real start timestamp. The report was already
 * built to hold them separately (every row model down to the CSV has carried
 * a "Manual hours" column since it was written), but nothing ever filled it,
 * so time added through "Add time for someone" was stored correctly and then
 * never appeared in the report it was added from.
 *
 * `source = 'manual'` is not cosmetic: the column also permits 'tracked', and
 * a tracked row would mirror an activity_sessions row that this report
 * already counts. Without the filter this would double-count that time.
 *
 * No timezone splitting here, unlike sessions: `date` is a DATE column, so
 * the entry is already attributed to a calendar day by whoever entered it.
 *
 * @param {{ memberIds: string[] | null, fromDay: string, toDay: string, projectIds?: string[] | null }} params
 */
export async function getManualTimeEntryRowsPg({ memberIds, fromDay, toDay, projectIds = null }) {
  const rows = await query(
    `SELECT
       te.member_id,
       te.project_id,
       te.date,
       te.duration,
       COALESCE(p.name, '') AS project_name,
       COALESCE(client_lookup.client_name, '') AS client_name,
       COALESCE(team_lookup.team_name, '')     AS team_name
     FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     LEFT JOIN LATERAL (
       SELECT c.name AS client_name
       FROM client_projects cp
       JOIN clients c ON c.id = cp.client_id
       WHERE cp.project_id = p.id
       ORDER BY cp.assigned_at ASC
       LIMIT 1
     ) client_lookup ON p.id IS NOT NULL
     LEFT JOIN LATERAL (
       SELECT tm_t.name AS team_name
       FROM team_members tm
       JOIN teams tm_t ON tm_t.id = tm.team_id
       WHERE tm.member_id = te.member_id
       ORDER BY tm.joined_at ASC
       LIMIT 1
     ) team_lookup ON true
     WHERE te.source = 'manual'
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
    day: String(row.date).slice(0, 10),
    project_name: row.project_name,
    client_name: row.client_name,
    team_name: row.team_name,
    manual_seconds: Math.max(0, Number(row.duration) || 0),
  }));
}
