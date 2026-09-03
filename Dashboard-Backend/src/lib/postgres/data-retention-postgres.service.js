import { query } from "./client.js";

export async function getRetentionSettingsPg() {
  return query(`SELECT data_type, retention_days, updated_by, updated_at FROM data_retention_settings ORDER BY data_type`);
}

export async function setRetentionDaysPg(dataType, retentionDays, updatedBy) {
  const rows = await query(
    `UPDATE data_retention_settings SET retention_days = $2, updated_by = $3, updated_at = now()
     WHERE data_type = $1
     RETURNING data_type, retention_days, updated_by, updated_at`,
    [dataType, retentionDays, updatedBy ?? null],
  );
  return rows[0] ?? null;
}

export async function findExpiredArchivedScreenshotsPg(retentionDays) {
  return query(
    `SELECT id, screenshot_url FROM activity_screenshots
     WHERE captured_at < now() - ($1 || ' days')::interval
       AND screenshot_url IS NOT NULL`,
    [retentionDays],
  );
}

export async function deleteScreenshotsByIdPg(ids) {
  if (!ids.length) return 0;
  const result = await query(`DELETE FROM activity_screenshots WHERE id = ANY($1::uuid[]) RETURNING id`, [ids]);
  return result.length;
}

export async function deleteExpiredInlineScreenshotsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_screenshots
     WHERE captured_at < now() - ($1 || ' days')::interval AND image_data IS NOT NULL
     RETURNING id`,
    [retentionDays],
  );
  return result.length;
}

export async function deleteExpiredAppLogsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_app_logs WHERE started_at < now() - ($1 || ' days')::interval RETURNING id`,
    [retentionDays],
  );
  return result.length;
}

export async function deleteExpiredUrlLogsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_url_logs WHERE visited_at < now() - ($1 || ' days')::interval RETURNING id`,
    [retentionDays],
  );
  return result.length;
}

export async function deleteExpiredSessionsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_sessions
     WHERE ended_at IS NOT NULL AND ended_at < now() - ($1 || ' days')::interval
     RETURNING id`,
    [retentionDays],
  );
  return result.length;
}


export async function getAllScreenshotMetaForMemberPg(memberId) {
  return query(
    `SELECT id, session_id, task_id, task_title, app_name, page_title, activity_level, captured_at, source,
            (screenshot_url IS NOT NULL) AS archived
     FROM activity_screenshots WHERE member_id = $1 ORDER BY captured_at DESC`,
    [memberId],
  );
}

export async function getAllAppLogsForMemberPg(memberId) {
  return query(
    `SELECT l.id, l.session_id, l.task_id, l.task_title, a.name AS app_name, l.page_title,
            l.started_at, l.duration_seconds, l.source
     FROM activity_app_logs l JOIN apps a ON a.id = l.app_id
     WHERE l.member_id = $1 ORDER BY l.started_at DESC`,
    [memberId],
  );
}

export async function getAllUrlLogsForMemberPg(memberId) {
  return query(
    `SELECT id, session_id, task_id, task_title, url, domain, page_title, visited_at, duration_seconds, source
     FROM activity_url_logs WHERE member_id = $1 ORDER BY visited_at DESC`,
    [memberId],
  );
}

export async function getAllSessionsForMemberPg(memberId) {
  return query(
    `SELECT id, task_id, project_id, status, started_at, ended_at, active_seconds, idle_seconds, source, updated_at
     FROM activity_sessions WHERE member_id = $1 ORDER BY started_at DESC`,
    [memberId],
  );
}


export async function eraseMemberScreenshotsPg(memberId) {
  const rows = await query(
    `DELETE FROM activity_screenshots WHERE member_id = $1 RETURNING id, screenshot_url`,
    [memberId],
  );
  return rows;
}

export async function eraseMemberAppLogsPg(memberId) {
  const result = await query(`DELETE FROM activity_app_logs WHERE member_id = $1 RETURNING id`, [memberId]);
  return result.length;
}

export async function eraseMemberUrlLogsPg(memberId) {
  const result = await query(`DELETE FROM activity_url_logs WHERE member_id = $1 RETURNING id`, [memberId]);
  return result.length;
}

export async function eraseMemberEndedSessionsPg(memberId) {
  const result = await query(
    `DELETE FROM activity_sessions WHERE member_id = $1 AND ended_at IS NOT NULL RETURNING id`,
    [memberId],
  );
  return result.length;
}


export async function recordScreenshotAccessPg(input) {
  await query(
    `INSERT INTO screenshot_access_log (screenshot_id, screenshot_owner, reader_member_id) VALUES ($1, $2, $3)`,
    [input.screenshotId, input.screenshotOwner, input.readerMemberId],
  );
}

export async function getScreenshotAccessLogPg(screenshotOwner, limit = 200) {
  return query(
    `SELECT id, screenshot_id, reader_member_id, accessed_at FROM screenshot_access_log
     WHERE screenshot_owner = $1 ORDER BY accessed_at DESC LIMIT $2`,
    [screenshotOwner, limit],
  );
}
