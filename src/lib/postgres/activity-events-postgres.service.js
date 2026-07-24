import { getEnv } from "../../config/env.js";
import { getPostgresPool } from "./client.js";
import { parseProgressUuid } from "./task-member-progress.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

/** @returns {boolean} */
export function isActivityEventsPgEnabled() {
  const env = getEnv();
  if (!env.postgres.url) return false;
  return env.features.activityEventsPgEnabled === true;
}

/**
 * @param {string[] | null | undefined} memberIds
 * @returns {string[] | null}
 */
function filterMemberIds(memberIds) {
  if (memberIds === null || memberIds === undefined) return null;
  return memberIds.map((id) => parseProgressUuid(id)).filter(Boolean);
}

/**
 * @param {string} sql
 * @param {unknown[]} params
 */
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

/**
 * @param {{
 *   id: string,
 *   memberId: string,
 *   sessionId: string,
 *   taskId?: string | null,
 *   taskTitle?: string | null,
 *   screenshotUrl?: string | null,
 *   imageData?: Buffer | null,
 *   appName: string,
 *   pageTitle: string,
 *   activityLevel: number,
 *   capturedAt: Date,
 *   source: string,
 * }} row
 */
export async function insertActivityScreenshot(row) {
  if (!isActivityEventsPgEnabled()) return;
  const memberId = parseProgressUuid(row.memberId);
  if (!memberId) return;
  const taskId = row.taskId ? parseProgressUuid(row.taskId) : null;
  try {
    await pgQuery(
      `INSERT INTO activity_screenshots (
         id, member_id, session_id, task_id, task_title, screenshot_url, image_data, has_image,
         app_name, page_title, activity_level, captured_at, source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        memberId,
        row.sessionId,
        taskId,
        row.taskTitle ?? null,
        row.screenshotUrl ?? null,
        row.imageData ?? null,
        row.appName.slice(0, 200),
        row.pageTitle.slice(0, 300),
        row.activityLevel,
        row.capturedAt,
        normalizeSource(row.source),
      ],
    );
  } catch (err) {
    logSafeWarn("[activity-events pg screenshot]", err);
  }
}

/** @param {Record<string, unknown>} row */
export async function insertActivityAppLog(row) {
  if (!isActivityEventsPgEnabled()) return;
  const memberId = parseProgressUuid(String(row.memberId ?? ""));
  if (!memberId) return;
  const taskId = row.taskId ? parseProgressUuid(String(row.taskId)) : null;
  try {
    await pgQuery(
      `INSERT INTO activity_app_logs (
         id, member_id, session_id, task_id, task_title, app_name, page_title,
         started_at, duration_seconds, source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        memberId,
        row.sessionId,
        taskId,
        row.taskTitle ?? null,
        String(row.appName ?? "Unknown").slice(0, 200),
        String(row.pageTitle ?? "").slice(0, 300),
        row.startedAt instanceof Date ? row.startedAt : new Date(),
        Math.max(0, Math.floor(Number(row.durationSeconds ?? 30))),
        normalizeSource(String(row.source ?? "web")),
      ],
    );
  } catch (err) {
    logSafeWarn("[activity-events pg app]", err);
  }
}

/** @param {Record<string, unknown>} row */
export async function insertActivityUrlLog(row) {
  if (!isActivityEventsPgEnabled()) return;
  const memberId = parseProgressUuid(String(row.memberId ?? ""));
  if (!memberId) return;
  const taskId = row.taskId ? parseProgressUuid(String(row.taskId)) : null;
  try {
    await pgQuery(
      `INSERT INTO activity_url_logs (
         id, member_id, session_id, task_id, task_title, url, domain, page_title,
         visited_at, duration_seconds, source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        memberId,
        row.sessionId,
        taskId,
        row.taskTitle ?? null,
        String(row.url ?? "").slice(0, 2000),
        String(row.domain ?? "").slice(0, 255),
        String(row.pageTitle ?? "").slice(0, 300),
        row.visitedAt instanceof Date ? row.visitedAt : new Date(),
        Math.max(0, Math.floor(Number(row.durationSeconds ?? 30))),
        normalizeSource(String(row.source ?? "web")),
      ],
    );
  } catch (err) {
    logSafeWarn("[activity-events pg url]", err);
  }
}

/** @param {string} source */
function normalizeSource(source) {
  const s = String(source ?? "web").toLowerCase();
  if (s === "agent" || s === "desktop_agent") return "agent";
  return "web";
}

/**
 * @param {string[] | null | undefined} memberIds
 * @param {string} dayFilter
 * @param {number} limit
 */
export async function fetchPgScreenshots(memberIds, dayFilter, limit) {
  if (!isActivityEventsPgEnabled()) return [];
  const ids = filterMemberIds(memberIds);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = "WHERE 1=1";
  if (ids !== null) {
    params.push(ids);
    where += ` AND member_id = ANY($${params.length}::uuid[])`;
  }
  if (dayFilter) {
    params.push(dayFilter);
    where += ` AND captured_at::date = $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT id, member_id, session_id, task_id, task_title, screenshot_url, has_image,
            app_name, page_title, activity_level, captured_at, source
     FROM activity_screenshots
     ${where}
     ORDER BY captured_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result?.rows ?? [];
}

/** @param {string[] | null | undefined} memberIds @param {string} dayFilter @param {number} limit */
export async function fetchPgAppLogs(memberIds, dayFilter, limit) {
  if (!isActivityEventsPgEnabled()) return [];
  const ids = filterMemberIds(memberIds);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = "WHERE 1=1";
  if (ids !== null) {
    params.push(ids);
    where += ` AND member_id = ANY($${params.length}::uuid[])`;
  }
  if (dayFilter) {
    params.push(dayFilter);
    where += ` AND started_at::date = $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT id, member_id, session_id, task_id, task_title, app_name, page_title,
            started_at, duration_seconds, source
     FROM activity_app_logs
     ${where}
     ORDER BY started_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result?.rows ?? [];
}

/** @param {string[] | null | undefined} memberIds @param {string} dayFilter @param {number} limit */
export async function fetchPgUrlLogs(memberIds, dayFilter, limit) {
  if (!isActivityEventsPgEnabled()) return [];
  const ids = filterMemberIds(memberIds);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = "WHERE 1=1";
  if (ids !== null) {
    params.push(ids);
    where += ` AND member_id = ANY($${params.length}::uuid[])`;
  }
  if (dayFilter) {
    params.push(dayFilter);
    where += ` AND visited_at::date = $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT id, member_id, session_id, task_id, task_title, url, domain, page_title,
            visited_at, duration_seconds, source
     FROM activity_url_logs
     ${where}
     ORDER BY visited_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result?.rows ?? [];
}

/** @param {string} screenshotId */
export async function fetchPgScreenshotById(screenshotId) {
  if (!isActivityEventsPgEnabled()) return null;
  const id = parseProgressUuid(screenshotId);
  if (!id) return null;
  const result = await pgQuery(
    `SELECT id, member_id, session_id, screenshot_url, image_data, has_image, app_name, page_title, captured_at
     FROM activity_screenshots WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result?.rows?.[0] ?? null;
}
