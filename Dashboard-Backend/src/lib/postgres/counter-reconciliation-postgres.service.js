import { query } from "./client.js";

/** OBS-1: per-member session-store total for one calendar day, bucketed by the day each session started (same attribution CQ-2 uses for the rollup side). */
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

/** OBS-1: per-member daily-rollup total for the same calendar day. */
export async function fetchDailyRollupByMemberForDayPg(day) {
  const rows = await query(
    `SELECT member_id, active_seconds
     FROM daily_member_active_seconds
     WHERE day = $1`,
    [day],
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.active_seconds) || 0]));
}

/** OBS-1: per-member lifetime total across every task, from task_member_progress (which carries no day column - see the sweep job for why this is a lifetime, not per-day, comparison). */
export async function fetchLifetimeTaskProgressByMemberPg() {
  const rows = await query(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM task_member_progress
     GROUP BY member_id`,
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}

/** OBS-1: per-member lifetime total across every day, from daily_member_active_seconds. */
export async function fetchLifetimeDailyRollupByMemberPg() {
  const rows = await query(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM daily_member_active_seconds
     GROUP BY member_id`,
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}
