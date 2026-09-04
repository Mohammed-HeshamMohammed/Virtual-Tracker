import { getPostgresPool } from "./client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

async function pgQuery(sql, params = []) {
  const pool = getPostgresPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function fetchRecentScreenshotsPg(since) {
  const result = await pgQuery(
    // COALESCE to the original: a manager can correct activity_level, and
    // anti-cheat must be judged on what the agent measured, never on the
    // correction - otherwise integrity checking becomes editable by the
    // people it exists to check.
    `SELECT member_id, session_id, perceptual_hash,
            COALESCE(activity_level_original, activity_level) AS activity_level,
            keystroke_count, injected_event_count
     FROM activity_screenshots
     WHERE captured_at >= $1
     ORDER BY session_id, captured_at ASC`,
    [since],
  );
  return result?.rows ?? [];
}

export async function fetchRecentActivityLevelsBySessionPg(since) {
  const result = await pgQuery(
    // Same reason as above - the average that feeds detectCategoryConflict
    // has to be the measured one.
    `SELECT session_id, member_id,
            AVG(COALESCE(activity_level_original, activity_level))::float AS avg_activity
     FROM activity_screenshots
     WHERE captured_at >= $1
     GROUP BY session_id, member_id`,
    [since],
  );
  return result?.rows ?? [];
}

export async function fetchRecentAppLogNamesPg(since) {
  const result = await pgQuery(
    `SELECT al.session_id, al.member_id, a.name AS app_name, al.duration_seconds
     FROM activity_app_logs al
     JOIN apps a ON a.id = al.app_id
     WHERE al.started_at >= $1`,
    [since],
  );
  return result?.rows ?? [];
}

export async function fetchRecentUrlLogDomainsPg(since) {
  const result = await pgQuery(
    `SELECT session_id, member_id, domain, duration_seconds
     FROM activity_url_logs
     WHERE visited_at >= $1 AND domain <> ''`,
    [since],
  );
  return result?.rows ?? [];
}

export async function insertIntegrityFlagPg(row) {
  try {
    await pgQuery(
      `INSERT INTO activity_integrity_flags (id, member_id, session_id, flag_type, detail)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, flag_type) DO NOTHING`,
      [row.id, row.memberId, row.sessionId, row.flagType, row.detail],
    );
  } catch (err) {
    logSafeWarn("[integrity-flags pg insert]", err);
  }
}

export async function listIntegrityFlagsForMemberPg(memberId, limit = 50) {
  const result = await pgQuery(
    `SELECT id, session_id, flag_type, detail, detected_at, contested, contested_at, contested_note
     FROM activity_integrity_flags
     WHERE member_id = $1
     ORDER BY detected_at DESC
     LIMIT $2`,
    [memberId, limit],
  );
  return result?.rows ?? [];
}

export async function contestIntegrityFlagPg(id, note) {
  const result = await pgQuery(
    `UPDATE activity_integrity_flags
     SET contested = true, contested_at = now(), contested_note = $2
     WHERE id = $1
     RETURNING id, session_id, flag_type, detail, detected_at, contested, contested_at, contested_note`,
    [id, note ?? null],
  );
  return result?.rows?.[0] ?? null;
}

export async function getIntegrityFlagByIdPg(id) {
  const result = await pgQuery(
    `SELECT id, member_id, session_id, flag_type, detail, detected_at, contested, contested_at, contested_note
     FROM activity_integrity_flags
     WHERE id = $1`,
    [id],
  );
  return result?.rows?.[0] ?? null;
}

export async function listIntegrityFlagsForSessionPg(sessionId) {
  const result = await pgQuery(
    `SELECT id, flag_type, detail, detected_at, contested
     FROM activity_integrity_flags
     WHERE session_id = $1`,
    [sessionId],
  );
  return result?.rows ?? [];
}
