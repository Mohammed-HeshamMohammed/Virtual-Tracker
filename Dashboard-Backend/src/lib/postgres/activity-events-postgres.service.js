import { getPostgresPool } from "./client.js";
import { parseProgressUuid } from "./task-member-progress.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

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

/** @param {string} source */
function normalizeSource(source) {
  const s = String(source ?? "web").toLowerCase();
  if (s === "agent" || s === "desktop_agent") return "agent";
  return "web";
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

/**
 * @param {string[] | null | undefined} memberIds
 * @param {string} dayFilter
 * @param {number} limit
 */
export async function fetchPgScreenshots(memberIds, dayFilter, limit) {
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
  const id = parseProgressUuid(screenshotId);
  if (!id) return null;
  const result = await pgQuery(
    `SELECT id, member_id, session_id, screenshot_url, image_data, has_image, app_name, page_title, captured_at
     FROM activity_screenshots WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result?.rows?.[0] ?? null;
}

/** Latest screenshot for a member+session (for the "no recent screenshot" alert). */
export async function fetchLatestPgScreenshot(memberId, sessionId) {
  const id = parseProgressUuid(memberId);
  if (!id) return null;
  const result = await pgQuery(
    `SELECT captured_at FROM activity_screenshots
     WHERE member_id = $1 AND session_id = $2
     ORDER BY captured_at DESC LIMIT 1`,
    [id, sessionId],
  );
  return result?.rows?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// activity_sessions
// ---------------------------------------------------------------------------

const SESSION_COLUMNS = "id, member_id, task_id, status, started_at, ended_at, active_seconds, idle_seconds, updated_at";

/** Most recently started open (ended_at IS NULL) session for a member. */
export async function findOpenPgSession(memberId) {
  const id = parseProgressUuid(memberId);
  if (!id) return null;
  const result = await pgQuery(
    `SELECT ${SESSION_COLUMNS} FROM activity_sessions
     WHERE member_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [id],
  );
  return result?.rows?.[0] ?? null;
}

/** @param {string} sessionId */
export async function getPgSessionById(sessionId) {
  const result = await pgQuery(`SELECT ${SESSION_COLUMNS} FROM activity_sessions WHERE id = $1 LIMIT 1`, [
    sessionId,
  ]);
  return result?.rows?.[0] ?? null;
}

/**
 * @param {{ id: string, memberId: string, taskId?: string|null, status: string,
 *   startedAt: Date, endedAt?: Date|null, activeSeconds?: number, idleSeconds?: number, updatedAt: Date }} row
 */
export async function createPgSession(row) {
  const memberId = parseProgressUuid(row.memberId);
  if (!memberId) return null;
  const taskId = row.taskId ? parseProgressUuid(row.taskId) : null;
  const result = await pgQuery(
    `INSERT INTO activity_sessions (id, member_id, task_id, status, started_at, ended_at, active_seconds, idle_seconds, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${SESSION_COLUMNS}`,
    [
      row.id,
      memberId,
      taskId,
      row.status,
      row.startedAt,
      row.endedAt ?? null,
      row.activeSeconds ?? 0,
      row.idleSeconds ?? 0,
      row.updatedAt,
    ],
  );
  return result?.rows?.[0] ?? null;
}

/**
 * Partial update - only the provided fields change.
 * @param {string} sessionId
 * @param {{ status?: string, endedAt?: Date|null, taskId?: string|null, activeSeconds?: number, idleSeconds?: number, updatedAt: Date }} patch
 */
export async function updatePgSession(sessionId, patch) {
  const sets = [];
  const params = [sessionId];
  const add = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.endedAt !== undefined) add("ended_at", patch.endedAt);
  if (patch.taskId !== undefined) add("task_id", patch.taskId ? parseProgressUuid(patch.taskId) : null);
  if (patch.activeSeconds !== undefined) add("active_seconds", patch.activeSeconds);
  if (patch.idleSeconds !== undefined) add("idle_seconds", patch.idleSeconds);
  add("updated_at", patch.updatedAt ?? new Date());
  if (sets.length === 0) return;
  await pgQuery(`UPDATE activity_sessions SET ${sets.join(", ")} WHERE id = $1`, params);
}

/**
 * Sum of active_seconds for a member's sessions started within [fromMs, toMs], optionally for one task.
 * @param {string} memberId
 * @param {{ fromMs: number, toMs: number, taskId?: string|null }} range
 */
export async function sumPgMemberActiveSeconds(memberId, { fromMs, toMs, taskId }) {
  const id = parseProgressUuid(memberId);
  if (!id) return 0;
  const params = [id, new Date(fromMs), new Date(toMs)];
  let where = "member_id = $1 AND started_at >= $2 AND started_at <= $3";
  if (taskId) {
    params.push(taskId);
    where += ` AND task_id = $${params.length}`;
  }
  const result = await pgQuery(
    `SELECT COALESCE(SUM(active_seconds), 0) AS total FROM activity_sessions WHERE ${where}`,
    params,
  );
  return Math.max(0, Math.floor(Number(result?.rows?.[0]?.total ?? 0)));
}

/** For the dashboard base loader - a bounded snapshot of session rows. */
export async function fetchPgSessionsForDashboard(limit = 500) {
  const result = await pgQuery(
    `SELECT ${SESSION_COLUMNS} FROM activity_sessions ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return result?.rows ?? [];
}

/** Every currently-open (ended_at IS NULL) session, one per member at most is expected but not enforced. */
export async function fetchAllOpenPgSessions(limit = 2000) {
  const result = await pgQuery(
    `SELECT ${SESSION_COLUMNS} FROM activity_sessions WHERE ended_at IS NULL ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return result?.rows ?? [];
}

// ---------------------------------------------------------------------------
// activity_alert_log
// ---------------------------------------------------------------------------

/** @param {string} subjectMemberId @param {string} alertType @param {number} cooldownMs */
export async function wasPgAlertSentRecently(subjectMemberId, alertType, cooldownMs) {
  const id = parseProgressUuid(subjectMemberId);
  if (!id) return false;
  const result = await pgQuery(
    `SELECT 1 FROM activity_alert_log
     WHERE subject_member_id = $1 AND alert_type = $2 AND sent_at > $3
     LIMIT 1`,
    [id, alertType, new Date(Date.now() - cooldownMs)],
  );
  return (result?.rows?.length ?? 0) > 0;
}

/** @param {string} subjectMemberId @param {string} alertType @param {string[]} recipientIds */
export async function recordPgAlertSent(subjectMemberId, alertType, recipientIds) {
  const id = parseProgressUuid(subjectMemberId);
  if (!id) return;
  await pgQuery(
    `INSERT INTO activity_alert_log (subject_member_id, alert_type, recipient_ids, sent_at)
     VALUES ($1, $2, $3::jsonb, now())`,
    [id, alertType, JSON.stringify(recipientIds)],
  );
}

// ---------------------------------------------------------------------------
// member-id reassignment (member dedupe/merge support)
// ---------------------------------------------------------------------------

const REASSIGNABLE_TABLES = [
  { table: "activity_sessions", column: "member_id" },
  { table: "activity_screenshots", column: "member_id" },
  { table: "activity_app_logs", column: "member_id" },
  { table: "activity_url_logs", column: "member_id" },
  { table: "activity_alert_log", column: "subject_member_id" },
];

/** Repoint every activity_* row's member reference from fromId to toId (member merge/dedupe). */
export async function reassignPgActivityMemberId(fromId, toId) {
  const from = parseProgressUuid(fromId);
  const to = parseProgressUuid(toId);
  if (!from || !to || from === to) return;
  for (const { table, column } of REASSIGNABLE_TABLES) {
    await pgQuery(`UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [from, to]);
  }
}
