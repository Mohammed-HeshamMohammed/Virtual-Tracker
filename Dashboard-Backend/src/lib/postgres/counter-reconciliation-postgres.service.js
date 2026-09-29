import { queryAsAdmin } from "./client.js";

// §0.1 blocker 5: sweep-only (counter-reconciliation-sweep.service.js is the
// only caller), and grouped by member_id globally rather than per tenant -
// unlike the abandoned-session/integrity sweeps, this doesn't need a
// per-tenant withTenant() loop, since there is no per-tenant aggregation to
// keep separate. It needs admin visibility instead, once RLS is live.

export async function fetchSessionActiveSecondsByMemberForDayPg(day) {
  const rows = await queryAsAdmin(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM activity_sessions
     WHERE started_at::date = $1
     GROUP BY member_id`,
    [day],
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}

export async function fetchDailyRollupByMemberForDayPg(day) {
  const rows = await queryAsAdmin(
    `SELECT member_id, active_seconds
     FROM daily_member_active_seconds
     WHERE day = $1`,
    [day],
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.active_seconds) || 0]));
}

export async function fetchLifetimeTaskProgressByMemberPg() {
  const rows = await queryAsAdmin(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM task_member_progress
     GROUP BY member_id`,
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}

export async function fetchLifetimeDailyRollupByMemberPg() {
  const rows = await queryAsAdmin(
    `SELECT member_id, SUM(active_seconds) AS total
     FROM daily_member_active_seconds
     GROUP BY member_id`,
  );
  return new Map(rows.map((r) => [String(r.member_id), Number(r.total) || 0]));
}
