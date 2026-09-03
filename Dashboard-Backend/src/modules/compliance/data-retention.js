import { isManagementRole } from "../../http/auth-context.js";
import { deleteFromGCS } from "../../lib/gcs/upload.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import {
  getRetentionSettingsPg,
  setRetentionDaysPg,
  findExpiredArchivedScreenshotsPg,
  deleteScreenshotsByIdPg,
  deleteExpiredInlineScreenshotsPg,
  deleteExpiredAppLogsPg,
  deleteExpiredUrlLogsPg,
  deleteExpiredSessionsPg,
  getAllScreenshotMetaForMemberPg,
  getAllAppLogsForMemberPg,
  getAllUrlLogsForMemberPg,
  getAllSessionsForMemberPg,
  eraseMemberScreenshotsPg,
  eraseMemberAppLogsPg,
  eraseMemberUrlLogsPg,
  eraseMemberEndedSessionsPg,
  recordScreenshotAccessPg,
  getScreenshotAccessLogPg,
} from "../../lib/postgres/data-retention-postgres.service.js";

export const DATA_TYPES = Object.freeze(["screenshots", "app_logs", "url_logs", "sessions"]);

function normalizeSettingsRow(row) {
  return {
    dataType: row.data_type,
    retentionDays: row.retention_days,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getRetentionSettings() {
  const rows = await getRetentionSettingsPg();
  return rows.map(normalizeSettingsRow);
}

export async function setRetentionDays(dataType, retentionDays, actor) {
  if (!DATA_TYPES.includes(dataType)) {
    const err = new Error(`Unknown data type: ${dataType}`);
    err.code = "UNKNOWN_DATA_TYPE";
    throw err;
  }
  const days = Math.floor(Number(retentionDays));
  if (!Number.isFinite(days) || days <= 0) {
    const err = new Error("retentionDays must be a positive number of days.");
    err.code = "INVALID_RETENTION_DAYS";
    throw err;
  }
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change retention settings.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const row = await setRetentionDaysPg(dataType, days, actor.memberId);
  return row ? normalizeSettingsRow(row) : null;
}

async function retentionDaysFor(dataType) {
  const settings = await getRetentionSettings();
  return settings.find((s) => s.dataType === dataType)?.retentionDays ?? 90;
}

export async function runRetentionSweep() {
  const settings = await getRetentionSettings();
  const days = Object.fromEntries(settings.map((s) => [s.dataType, s.retentionDays]));
  const result = { screenshotsArchivedDeleted: 0, screenshotsInlineDeleted: 0, appLogsDeleted: 0, urlLogsDeleted: 0, sessionsDeleted: 0 };

  const expiredArchived = await findExpiredArchivedScreenshotsPg(days.screenshots ?? 90);
  const deletable = [];
  for (const row of expiredArchived) {
    try {
      if (row.screenshot_url) await deleteFromGCS(row.screenshot_url);
      deletable.push(row.id);
    } catch (err) {
      logSafeWarn("[data-retention] GCS delete failed, leaving row for next sweep", { id: row.id, err });
    }
  }
  if (deletable.length) {
    result.screenshotsArchivedDeleted = await deleteScreenshotsByIdPg(deletable);
  }
  result.screenshotsInlineDeleted = await deleteExpiredInlineScreenshotsPg(days.screenshots ?? 90);
  result.appLogsDeleted = await deleteExpiredAppLogsPg(days.app_logs ?? 180);
  result.urlLogsDeleted = await deleteExpiredUrlLogsPg(days.url_logs ?? 180);
  result.sessionsDeleted = await deleteExpiredSessionsPg(days.sessions ?? 730);
  return result;
}

export async function buildDsarExport(memberId) {
  const [screenshots, appLogs, urlLogs, sessions] = await Promise.all([
    getAllScreenshotMetaForMemberPg(memberId),
    getAllAppLogsForMemberPg(memberId),
    getAllUrlLogsForMemberPg(memberId),
    getAllSessionsForMemberPg(memberId),
  ]);
  return {
    memberId,
    generatedAt: new Date().toISOString(),
    screenshots,
    appLogs,
    urlLogs,
    sessions,
  };
}

export async function eraseMemberMonitoringData(memberId, actor) {
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may erase monitoring data.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const screenshotRows = await eraseMemberScreenshotsPg(memberId);
  for (const row of screenshotRows) {
    if (!row.screenshot_url) continue;
    try {
      await deleteFromGCS(row.screenshot_url);
    } catch (err) {
      logSafeWarn("[data-retention] erasure: GCS delete failed for archived screenshot", { id: row.id, err });
    }
  }
  const appLogsDeleted = await eraseMemberAppLogsPg(memberId);
  const urlLogsDeleted = await eraseMemberUrlLogsPg(memberId);
  const sessionsDeleted = await eraseMemberEndedSessionsPg(memberId);
  return {
    memberId,
    screenshotsDeleted: screenshotRows.length,
    appLogsDeleted,
    urlLogsDeleted,
    sessionsDeleted,
  };
}

export async function recordScreenshotAccess(input) {
  await recordScreenshotAccessPg(input);
}

export async function getScreenshotAccessLog(screenshotOwner) {
  const rows = await getScreenshotAccessLogPg(screenshotOwner);
  return rows.map((r) => ({
    id: r.id,
    screenshotId: r.screenshot_id,
    readerMemberId: r.reader_member_id,
    accessedAt: r.accessed_at,
  }));
}
