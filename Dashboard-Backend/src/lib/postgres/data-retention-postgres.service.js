import { query } from "./client.js";
import { MAIN_TENANT_ID } from "./ensure-tenancy-schema.js";

/**
 * PLAN-customer-accounts-and-tenancy.md §16.6: "expiry freezes retention -
 * the sweep clock stops". A tenant that has expired must not have its
 * screenshots/logs/sessions aged out from under it - a customer who renews
 * six months later must find their data exactly as it was, not partially
 * deleted by a sweep that kept running while they were locked out. Every
 * delete/find query below is restricted to tenants that are currently
 * active; an inactive tenant's rows are simply skipped until it either
 * renews or is explicitly removed (§14.1 - the only thing that deletes
 * customer data on purpose).
 *
 * data_retention_settings itself is per-tenant now (§15.3), but the sweep
 * below still runs on ONE set of settings (the main tenant's) rather than a
 * full per-tenant loop with each tenant's own retention days - a smaller,
 * lower-risk fix than restructuring the whole sweep, and the part of §16.6
 * that actually matters (never touching an expired tenant's data) is fully
 * delivered by the ACTIVE_TENANT_FILTER below regardless. Per-tenant
 * retention-day customization is a real gap, tracked as follow-up work, not
 * silently dropped.
 */
const ACTIVE_TENANT_FILTER = `tenant_id IN (SELECT id FROM tenants WHERE lifecycle = 'live' AND now() < period_end)`;

export async function getRetentionSettingsPg() {
  return query(
    `SELECT data_type, retention_days, updated_by, updated_at FROM data_retention_settings
     WHERE tenant_id = $1 ORDER BY data_type`,
    [MAIN_TENANT_ID],
  );
}

export async function setRetentionDaysPg(dataType, retentionDays, updatedBy) {
  const rows = await query(
    `UPDATE data_retention_settings SET retention_days = $2, updated_by = $3, updated_at = now()
     WHERE data_type = $1 AND tenant_id = $4
     RETURNING data_type, retention_days, updated_by, updated_at`,
    [dataType, retentionDays, updatedBy ?? null, MAIN_TENANT_ID],
  );
  return rows[0] ?? null;
}

export async function findExpiredArchivedScreenshotsPg(retentionDays) {
  return query(
    `SELECT id, screenshot_url FROM activity_screenshots
     WHERE captured_at < now() - ($1 || ' days')::interval
       AND screenshot_url IS NOT NULL
       AND ${ACTIVE_TENANT_FILTER}`,
    [retentionDays],
  );
}

export async function deleteScreenshotsByIdPg(ids) {
  if (!ids.length) return 0;
  const result = await query(`DELETE FROM activity_screenshots WHERE id = ANY($1::uuid[]) RETURNING id`, [ids]);
  return result.length;
}

export async function findScreenshotsToArchivePg(archiveDays, limit = 500) {
  return query(
    `SELECT id, member_id, image_data, captured_at
     FROM activity_screenshots
     WHERE image_data IS NOT NULL AND captured_at < now() - ($1 || ' days')::interval
       AND ${ACTIVE_TENANT_FILTER}
     ORDER BY captured_at ASC
     LIMIT $2`,
    [archiveDays, limit],
  );
}

export async function markScreenshotArchivedPg(id, objectPath) {
  await query(`UPDATE activity_screenshots SET screenshot_url = $2, image_data = NULL WHERE id = $1`, [id, objectPath]);
}

export async function deleteExpiredInlineScreenshotsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_screenshots
     WHERE captured_at < now() - ($1 || ' days')::interval AND image_data IS NOT NULL
       AND ${ACTIVE_TENANT_FILTER}
     RETURNING id`,
    [retentionDays],
  );
  return result.length;
}

export async function deleteExpiredAppLogsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_app_logs WHERE started_at < now() - ($1 || ' days')::interval AND ${ACTIVE_TENANT_FILTER} RETURNING id`,
    [retentionDays],
  );
  return result.length;
}

export async function deleteExpiredUrlLogsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_url_logs WHERE visited_at < now() - ($1 || ' days')::interval AND ${ACTIVE_TENANT_FILTER} RETURNING id`,
    [retentionDays],
  );
  return result.length;
}

export async function deleteExpiredSessionsPg(retentionDays) {
  const result = await query(
    `DELETE FROM activity_sessions
     WHERE ended_at IS NOT NULL AND ended_at < now() - ($1 || ' days')::interval
       AND ${ACTIVE_TENANT_FILTER}
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
