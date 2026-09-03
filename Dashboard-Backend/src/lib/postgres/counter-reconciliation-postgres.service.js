import { query } from "./client.js";

export async function fetchSessionActiveSecondsByMemberForDayPg(day) {
  const rows = await query(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM activity_sessions
     WHERE started_at::date = $1
     GROUP BY member_id`,
    [day],
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}

export async function fetchDailyRollupByMemberForDayPg(day) {
  const rows = await query(
    `SELECT member_id, active_seconds
     FROM daily_member_active_seconds
     WHERE day = $1`,
    [day],
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.active_seconds) || 0]));
}

export async function fetchLifetimeTaskProgressByMemberPg() {
  const rows = await query(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM task_member_progress
     GROUP BY member_id`,
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}

export async function fetchLifetimeDailyRollupByMemberPg() {
  const rows = await query(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM daily_member_active_seconds
     GROUP BY member_id`,
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}
