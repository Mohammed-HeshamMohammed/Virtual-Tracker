import { getPostgresPool, withTransaction } from "./client.js";
import { parseProgressUuid } from "./task-member-progress.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { normalizeAppName } from "../../modules/activity/app-name.js";
import { getMemberTimezone } from "../../modules/reports/member-timezones.js";
import { localDayFor } from "../time/timezone-utils.js";
import { resolveProjectTimeZone } from "../time/resolve-time-zone.js";
import { recordSecurityEvent } from "../../core/metrics.js";

const APP_LOG_MERGE_GRACE_MS = 120_000;

function filterMemberIds(memberIds) {
  if (memberIds === null || memberIds === undefined) return null;
  return memberIds.map((id) => parseProgressUuid(id)).filter(Boolean);
}

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

function normalizeSource(source) {
  const s = String(source ?? "web").toLowerCase();
  if (s === "agent" || s === "desktop_agent") return "agent";
  return "web";
}

function normalizeActivitySignal(signal) {
  const nonNegativeInt = (value) => Math.max(0, Math.floor(Number(value) || 0));
  return {
    keystrokeCount: nonNegativeInt(signal?.keystrokeCount),
    distinctKeyCount: nonNegativeInt(signal?.distinctKeyCount),
    mouseDistancePx: nonNegativeInt(signal?.mouseDistancePx),
    injectedEventCount: nonNegativeInt(signal?.injectedEventCount),
    activeSecondsInWindow: nonNegativeInt(signal?.activeSecondsInWindow),
  };
}

export async function insertActivityScreenshot(row) {
  const memberId = parseProgressUuid(row.memberId);
  if (!memberId) return;
  const taskId = row.taskId ? parseProgressUuid(row.taskId) : null;
  const signal = normalizeActivitySignal(row.signal);
  try {
    await pgQuery(
      `INSERT INTO activity_screenshots (
         id, member_id, session_id, task_id, task_title, screenshot_url, image_data,
         app_name, page_title, activity_level, captured_at, source,
         keystroke_count, distinct_key_count, mouse_distance_px, injected_event_count, active_seconds_in_window,
         perceptual_hash, url, domain
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
        signal.keystrokeCount,
        signal.distinctKeyCount,
        signal.mouseDistancePx,
        signal.injectedEventCount,
        signal.activeSecondsInWindow,
        row.perceptualHash ?? null,
        row.url ?? null,
        row.domain ?? null,
      ],
    );
  } catch (err) {
    logSafeWarn("[activity-events pg screenshot]", err);
  }
}

async function resolveAppId(name) {
  const result = await pgQuery(
    `INSERT INTO apps (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  );
  return result?.rows?.[0]?.id ?? null;
}

/** Store the agent-reported icon for an app. Only overwrites when there is no
 *  icon yet or the stored one is over a day old, so a steady stream of app
 *  logs doesn't rewrite the same bytes every 15s. */
export async function setAppIconPg(name, dataUrl) {
  const trimmed = String(name ?? "").trim().slice(0, 200);
  if (!trimmed || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return;
  await pgQuery(
    `INSERT INTO apps (name, icon_data_url, icon_updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET
       icon_data_url = EXCLUDED.icon_data_url,
       icon_updated_at = now()
     WHERE apps.icon_data_url IS NULL
        OR apps.icon_updated_at IS NULL
        OR apps.icon_updated_at < now() - interval '1 day'`,
    [trimmed, dataUrl.slice(0, 20000)],
  );
}

/** app name (lowercased) -> icon data URL, for the names that have one. */
export async function getAppIconsByNamesPg(names) {
  const list = [...new Set((names ?? []).map((n) => String(n ?? "").trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return new Map();
  const result = await pgQuery(
    `SELECT name, icon_data_url FROM apps
     WHERE icon_data_url IS NOT NULL AND lower(name) = ANY($1::text[])`,
    [list],
  );
  const map = new Map();
  for (const r of result?.rows ?? []) {
    if (r.icon_data_url) map.set(String(r.name).toLowerCase(), r.icon_data_url);
  }
  return map;
}

export async function insertActivityAppLog(row) {
  const memberId = parseProgressUuid(String(row.memberId ?? ""));
  if (!memberId) return;
  const taskId = row.taskId ? parseProgressUuid(String(row.taskId)) : null;
  const appName = normalizeAppName(String(row.appName ?? "Unknown").slice(0, 200)) || "Unknown";
  const pageTitle = String(row.pageTitle ?? "").slice(0, 300);
  const startedAt = row.startedAt instanceof Date ? row.startedAt : new Date();
  const durationSeconds = Math.max(0, Math.floor(Number(row.durationSeconds ?? 30)));
  const source = normalizeSource(String(row.source ?? "web"));
  const signal = normalizeActivitySignal(/** @type {ActivitySignal | undefined} */ (row.signal));

  try {
    const appId = await resolveAppId(appName);
    const cutoff = new Date(startedAt.getTime() - APP_LOG_MERGE_GRACE_MS);
    const merged = await pgQuery(
      `UPDATE activity_app_logs
       SET duration_seconds = duration_seconds + $1, ended_at = $2,
           keystroke_count = keystroke_count + $7, distinct_key_count = distinct_key_count + $8,
           mouse_distance_px = mouse_distance_px + $9, injected_event_count = injected_event_count + $10,
           active_seconds_in_window = active_seconds_in_window + $11
       WHERE id = (
         SELECT id FROM activity_app_logs
         WHERE session_id = $3 AND app_id = $4 AND page_title = $5 AND ended_at >= $6
         ORDER BY started_at DESC LIMIT 1
       )
       RETURNING id`,
      [
        durationSeconds,
        startedAt,
        row.sessionId,
        appId,
        pageTitle,
        cutoff,
        signal.keystrokeCount,
        signal.distinctKeyCount,
        signal.mouseDistancePx,
        signal.injectedEventCount,
        signal.activeSecondsInWindow,
      ],
    );
    if (merged?.rows?.length) return;

    await pgQuery(
      `INSERT INTO activity_app_logs (
         id, member_id, session_id, task_id, task_title, app_id, page_title,
         started_at, ended_at, duration_seconds, source,
         keystroke_count, distinct_key_count, mouse_distance_px, injected_event_count, active_seconds_in_window
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        memberId,
        row.sessionId,
        taskId,
        row.taskTitle ?? null,
        appId,
        pageTitle,
        startedAt,
        durationSeconds,
        source,
        signal.keystrokeCount,
        signal.distinctKeyCount,
        signal.mouseDistancePx,
        signal.injectedEventCount,
        signal.activeSecondsInWindow,
      ],
    );
  } catch (err) {
    logSafeWarn("[activity-events pg app]", err);
  }
}

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

function localDay(tsColumn) {
  return `(${tsColumn} AT TIME ZONE COALESCE(NULLIF(m_tz.timezone, ''), 'UTC'))::date`;
}

export async function fetchPgScreenshots(memberIds, dayFilter, limit, options = {}) {
  const ids = filterMemberIds(memberIds);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = "WHERE 1=1";
  if (ids !== null) {
    params.push(ids);
    where += ` AND sc.member_id = ANY($${params.length}::uuid[])`;
  }
  if (dayFilter) {
    params.push(dayFilter);
    where += ` AND ${localDay("sc.captured_at")} = $${params.length}::date`;
  } else if (options.sinceDay) {
    params.push(options.sinceDay);
    where += ` AND ${localDay("sc.captured_at")} >= $${params.length}::date`;
  }
  if (options.projectId) {
    // A screenshot's project comes from whichever of the two joins below
    // actually resolves - the task's project for a task-based session, the
    // session's own project for a task-less/calling one that never had a
    // task at all.
    params.push(options.projectId);
    where += ` AND (t.project_id = $${params.length} OR s.project_id = $${params.length})`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT sc.id, sc.member_id, sc.session_id, sc.task_id, sc.task_title, sc.screenshot_url,
            sc.app_name, sc.page_title, sc.activity_level, sc.captured_at, sc.source, sc.domain,
            COALESCE(pt.name, ps.name) AS project_name
     FROM activity_screenshots sc
     LEFT JOIN tasks t ON t.id = sc.task_id
     LEFT JOIN projects pt ON pt.id = t.project_id
     LEFT JOIN activity_sessions s ON s.id::text = sc.session_id
     LEFT JOIN projects ps ON ps.id = s.project_id
     LEFT JOIN members m_tz ON m_tz.id = sc.member_id
     ${where}
     ORDER BY sc.captured_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result?.rows ?? [];
}

export async function fetchPgAppLogs(memberIds, dayFilter, limit, options = {}) {
  const ids = filterMemberIds(memberIds);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = "WHERE 1=1";
  if (ids !== null) {
    params.push(ids);
    where += ` AND l.member_id = ANY($${params.length}::uuid[])`;
  }
  if (dayFilter) {
    params.push(dayFilter);
    where += ` AND ${localDay("l.started_at")} = $${params.length}::date`;
  } else if (options.sinceDay) {
    params.push(options.sinceDay);
    where += ` AND ${localDay("l.started_at")} >= $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT l.id, l.member_id, l.session_id, l.task_id, l.task_title, a.name AS app_name, l.page_title,
            l.started_at, l.duration_seconds, l.source
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     LEFT JOIN members m_tz ON m_tz.id = l.member_id
     ${where}
     ORDER BY l.started_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result?.rows ?? [];
}

export async function fetchPgUrlLogs(memberIds, dayFilter, limit, options = {}) {
  const ids = filterMemberIds(memberIds);
  if (Array.isArray(ids) && ids.length === 0) return [];

  const params = [];
  let where = "WHERE 1=1";
  if (ids !== null) {
    params.push(ids);
    where += ` AND u.member_id = ANY($${params.length}::uuid[])`;
  }
  if (dayFilter) {
    params.push(dayFilter);
    where += ` AND ${localDay("u.visited_at")} = $${params.length}::date`;
  } else if (options.sinceDay) {
    // Was the only one of the three fetchers without this, though its two
    // siblings (screenshots, app logs) both support it.
    params.push(options.sinceDay);
    where += ` AND ${localDay("u.visited_at")} >= $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT u.id, u.member_id, u.session_id, u.task_id, u.task_title, u.url, u.domain, u.page_title,
            u.visited_at, u.duration_seconds, u.source
     FROM activity_url_logs u
     LEFT JOIN members m_tz ON m_tz.id = u.member_id
     ${where}
     ORDER BY u.visited_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result?.rows ?? [];
}


/**
 * Top apps by tracked time for one member on one project, most recent
 * `fromDay..toDay` window. Same project resolution fetchPgScreenshots uses
 * - a task-based session's project comes from its task, a task-less/
 * calling one from the session itself - since a project's app logs can
 * come from either kind of session over its lifetime.
 */
export async function sumAppLogSecondsByAppNameForProjectPg(memberId, projectId, { fromDay, toDay }, limit = 5) {
  const id = parseProgressUuid(memberId);
  if (!id || !projectId) return [];
  const result = await pgQuery(
    `SELECT a.name AS app_name, SUM(l.duration_seconds)::bigint AS total_seconds
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     LEFT JOIN tasks t ON t.id = l.task_id
     LEFT JOIN activity_sessions s ON s.id::text = l.session_id
     WHERE l.member_id = $1
       AND l.started_at::date >= $2::date AND l.started_at::date <= $3::date
       AND (t.project_id = $4 OR s.project_id = $4)
     GROUP BY a.name
     ORDER BY total_seconds DESC
     LIMIT $5`,
    [id, fromDay, toDay, projectId, limit],
  );
  return result?.rows ?? [];
}


export async function findUnclassifiedAppsPg(sinceDays = 30, limit = 20) {
  const result = await pgQuery(
    `SELECT a.name AS app_name, SUM(l.duration_seconds)::bigint AS total_seconds, COUNT(*)::int AS log_count
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     LEFT JOIN activity_categories c ON c.match_type = 'app' AND lower(c.pattern) = lower(a.name)
     WHERE l.started_at >= now() - ($1 || ' days')::interval
       AND (c.id IS NULL OR c.category = 'unclassified')
     GROUP BY a.name
     ORDER BY total_seconds DESC
     LIMIT $2`,
    [sinceDays, limit],
  );
  return result?.rows ?? [];
}

export async function findUnclassifiedDomainsPg(sinceDays = 30, limit = 20) {
  const result = await pgQuery(
    `SELECT l.domain, SUM(l.duration_seconds)::bigint AS total_seconds, COUNT(*)::int AS log_count
     FROM activity_url_logs l
     LEFT JOIN activity_categories c ON c.match_type = 'domain' AND lower(c.pattern) = lower(l.domain)
     WHERE l.visited_at >= now() - ($1 || ' days')::interval
       AND l.domain IS NOT NULL AND l.domain != ''
       AND (c.id IS NULL OR c.category = 'unclassified')
     GROUP BY l.domain
     ORDER BY total_seconds DESC
     LIMIT $2`,
    [sinceDays, limit],
  );
  return result?.rows ?? [];
}

export async function fetchPgScreenshotById(screenshotId) {
  const id = parseProgressUuid(screenshotId);
  if (!id) return null;
  const result = await pgQuery(
    `SELECT id, member_id, session_id, screenshot_url, image_data, app_name, page_title, captured_at
     FROM activity_screenshots WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result?.rows?.[0] ?? null;
}

/** Every capture in one session, oldest first - the input to run splitting. */
export async function fetchPgSessionScreenshots(sessionId) {
  const result = await pgQuery(
    `SELECT id, captured_at, activity_level, activity_level_original
     FROM activity_screenshots
     WHERE session_id = $1::text
     ORDER BY captured_at ASC`,
    [String(sessionId ?? "")],
  );
  return result?.rows ?? [];
}

/**
 * Apply a corrected activity level to a set of captures, in one transaction so
 * a run updates all-or-nothing.
 *
 * activity_level_original is written only on the FIRST edit (COALESCE), so
 * re-editing never overwrites what the agent measured - that column is both
 * the audit trail and the rollback path.
 */
export async function updatePgScreenshotActivityLevels(ids, { activityLevel, editedBy, reason }) {
  const cleanIds = (ids ?? []).map((id) => parseProgressUuid(String(id))).filter(Boolean);
  if (cleanIds.length === 0) return 0;
  const level = Math.max(0, Math.min(100, Math.floor(Number(activityLevel))));
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE activity_screenshots
       SET activity_level_original = COALESCE(activity_level_original, activity_level),
           activity_level = $2,
           activity_level_edited_by = $3,
           activity_level_edited_at = now(),
           activity_level_edit_reason = $4
       WHERE id = ANY($1::uuid[])`,
      [cleanIds, level, editedBy ? parseProgressUuid(editedBy) : null, reason || null],
    );
    return result.rowCount ?? 0;
  });
}

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


const SESSION_COLUMNS = "id, member_id, task_id, project_id, status, started_at, ended_at, active_seconds, idle_seconds, source, updated_at";

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

export async function getPgSessionById(sessionId) {
  const result = await pgQuery(`SELECT ${SESSION_COLUMNS} FROM activity_sessions WHERE id = $1 LIMIT 1`, [
    sessionId,
  ]);
  return result?.rows?.[0] ?? null;
}

export async function deleteActivitySessionWithChildrenPg(sessionId) {
  return withTransaction(async (client) => {
    const screenshots = await client.query(`DELETE FROM activity_screenshots WHERE session_id = $1::text`, [
      sessionId,
    ]);
    const appLogs = await client.query(`DELETE FROM activity_app_logs WHERE session_id = $1::text`, [sessionId]);
    const urlLogs = await client.query(`DELETE FROM activity_url_logs WHERE session_id = $1::text`, [sessionId]);
    const session = await client.query(`DELETE FROM activity_sessions WHERE id = $1`, [sessionId]);
    return {
      deletedSession: (session.rowCount ?? 0) > 0,
      screenshots: screenshots.rowCount ?? 0,
      appLogs: appLogs.rowCount ?? 0,
      urlLogs: urlLogs.rowCount ?? 0,
    };
  });
}

export async function deleteMemberDayActivityWithChildrenPg(memberId, day) {
  return withTransaction(async (client) => {
    const screenshots = await client.query(
      `DELETE FROM activity_screenshots WHERE member_id = $1 AND captured_at::date = $2::date`,
      [memberId, day],
    );
    const appLogs = await client.query(
      `DELETE FROM activity_app_logs WHERE member_id = $1 AND started_at::date = $2::date`,
      [memberId, day],
    );
    const urlLogs = await client.query(
      `DELETE FROM activity_url_logs WHERE member_id = $1 AND visited_at::date = $2::date`,
      [memberId, day],
    );
    const sessions = await client.query(
      `DELETE FROM activity_sessions WHERE member_id = $1 AND started_at::date = $2::date`,
      [memberId, day],
    );
    const entries = await client.query(`DELETE FROM time_entries WHERE member_id = $1 AND date = $2::date`, [
      memberId,
      day,
    ]);
    return {
      sessions: sessions.rowCount ?? 0,
      entries: entries.rowCount ?? 0,
      screenshots: screenshots.rowCount ?? 0,
      appLogs: appLogs.rowCount ?? 0,
      urlLogs: urlLogs.rowCount ?? 0,
    };
  });
}

export async function createPgSession(row) {
  const memberId = parseProgressUuid(row.memberId);
  if (!memberId) return null;
  const taskId = row.taskId ? parseProgressUuid(row.taskId) : null;
  const projectId = row.projectId ? parseProgressUuid(row.projectId) : null;
  const result = await pgQuery(
    `INSERT INTO activity_sessions (id, member_id, task_id, project_id, status, started_at, ended_at, active_seconds, idle_seconds, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${SESSION_COLUMNS}`,
    [
      row.id,
      memberId,
      taskId,
      projectId,
      row.status,
      row.startedAt,
      row.endedAt ?? null,
      row.activeSeconds ?? 0,
      row.idleSeconds ?? 0,
      normalizeSource(row.source),
      row.updatedAt,
    ],
  );
  return result?.rows?.[0] ?? null;
}

export async function updatePgSession(sessionId, patch, options = {}) {
  const allowDecrease = options.allowDecrease === true;
  const wantsActive = patch.activeSeconds !== undefined;
  const wantsIdle = patch.idleSeconds !== undefined;

  let prev = null;
  if (wantsActive || wantsIdle) {
    const prevResult = await pgQuery(
      `SELECT member_id, task_id, project_id, started_at, active_seconds, idle_seconds FROM activity_sessions WHERE id = $1`,
      [sessionId],
    );
    prev = prevResult?.rows?.[0] ?? null;
  }

  let effectiveActive = patch.activeSeconds;
  let effectiveIdle = patch.idleSeconds;
  if (prev) {
    if (wantsActive) {
      const incoming = Math.floor(patch.activeSeconds);
      const stored = Math.floor(Number(prev.active_seconds ?? 0));
      if (incoming < stored) {
        if (allowDecrease) {
          logSafeWarn("[activity-sessions] accepted downward active_seconds write", {
            sessionId,
            from: stored,
            to: incoming,
            reason: "idle-rewind/stop",
          });
          recordSecurityEvent({
            event: "active_seconds_decreased",
            detail: `session=${sessionId} from=${stored} to=${incoming} reason=stop`,
          });
        } else {
          logSafeWarn("[activity-sessions] rejected downward active_seconds write, clamped", {
            sessionId,
            attempted: incoming,
            keptAt: stored,
          });
          recordSecurityEvent({
            event: "active_seconds_decrease_rejected",
            detail: `session=${sessionId} attempted=${incoming} keptAt=${stored} reason=unexplained`,
          });
        }
      }
      effectiveActive = allowDecrease ? incoming : Math.max(incoming, stored);
    }
    if (wantsIdle) {
      const incoming = Math.floor(patch.idleSeconds);
      const stored = Math.floor(Number(prev.idle_seconds ?? 0));
      effectiveIdle = Math.max(incoming, stored);
    }
  }

  const sets = [];
  const params = [sessionId];
  const add = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.endedAt !== undefined) add("ended_at", patch.endedAt);
  if (patch.taskId !== undefined) add("task_id", patch.taskId ? parseProgressUuid(patch.taskId) : null);
  if (patch.projectId !== undefined) add("project_id", patch.projectId ? parseProgressUuid(patch.projectId) : null);
  if (patch.stopNote !== undefined) add("stop_note", patch.stopNote || null);
  if (wantsActive) add("active_seconds", effectiveActive);
  if (wantsIdle) add("idle_seconds", effectiveIdle);
  add("updated_at", patch.updatedAt ?? new Date());
  if (sets.length === 0) return;

  if (wantsActive && prev) {
    const delta = Math.floor(effectiveActive) - Math.floor(Number(prev.active_seconds ?? 0));
    if (delta !== 0) {
      await recordDailyActiveSecondsDelta(prev.member_id, prev.task_id, delta, prev.started_at, prev.project_id);
    }
  }

  await pgQuery(`UPDATE activity_sessions SET ${sets.join(", ")} WHERE id = $1`, params);
}

/**
 * Credit a session's active-time delta to the day that session *started*.
 *
 * Two deliberate properties, both load-bearing:
 *
 * 1. **Sticky attribution.** `attributedTo` is the session's `started_at`,
 *    never "now", so a shift running 8pm -> 5am lands entirely on the day it
 *    began. Crossing midnight does not hand the member a fresh daily
 *    allowance, and a shift that finishes inside a weekend still books its
 *    hours to the working day it started on - the rest day records nothing.
 * 2. **The member's own calendar.** The day is resolved through the member's
 *    IANA zone rather than being left to Postgres' `::date` cast (which would
 *    use the database session's timezone - effectively UTC, and unrelated to
 *    where the member actually is). Passing an explicit `YYYY-MM-DD` string
 *    means the stored bucket no longer depends on server configuration at all.
 */
async function recordDailyActiveSecondsDelta(memberId, taskId, deltaSeconds, attributedTo, projectId = null) {
  const delta = Math.trunc(Number(deltaSeconds) || 0);
  if (delta === 0) return;
  const startedAt = attributedTo ? new Date(attributedTo) : new Date();
  const anchor = Number.isNaN(startedAt.getTime()) ? new Date() : startedAt;

  // Two calendars on purpose (see lib/time/resolve-time-zone.js):
  //   - the member's own, for their personal daily/weekly totals, because a
  //     person cannot be having two different "todays" at once;
  //   - the project's, for task-scoped totals, so work on a client's timeline
  //     lines up with that client's days rather than the worker's.
  // They are the same value unless a project declares its own zone.
  const memberZone = await getMemberTimezone(memberId);
  const memberDay = localDayFor(anchor, memberZone);
  const taskDay = taskId ? localDayFor(anchor, await resolveProjectTimeZone(projectId, memberId)) : memberDay;
  const dayStr = memberDay;

  await pgQuery(
    `INSERT INTO daily_member_active_seconds (member_id, day, active_seconds)
     VALUES ($1, $2::date, GREATEST(0, $3::bigint))
     ON CONFLICT (member_id, day)
     DO UPDATE SET
       active_seconds = GREATEST(0, daily_member_active_seconds.active_seconds + $3::bigint),
       updated_at = now()`,
    [memberId, dayStr, delta],
  );
  if (taskId) {
    await pgQuery(
      `INSERT INTO daily_member_task_active_seconds (member_id, task_id, day, active_seconds)
       VALUES ($1, $2, $3::date, GREATEST(0, $4::bigint))
       ON CONFLICT (member_id, task_id, day)
       DO UPDATE SET
         active_seconds = GREATEST(0, daily_member_task_active_seconds.active_seconds + $4::bigint),
         updated_at = now()`,
      [memberId, taskId, taskDay, delta],
    );
  }
}

export async function sumDailyMemberActiveSeconds(memberId, { fromDay, toDay }) {
  const id = parseProgressUuid(memberId);
  if (!id) return 0;
  const result = await pgQuery(
    `SELECT COALESCE(SUM(active_seconds), 0) AS total FROM daily_member_active_seconds
     WHERE member_id = $1 AND day >= $2::date AND day <= $3::date`,
    [id, fromDay, toDay],
  );
  return Math.max(0, Math.floor(Number(result?.rows?.[0]?.total ?? 0)));
}

export async function sumMemberActiveIdleSeconds(memberId, { fromDay, toDay }) {
  const id = parseProgressUuid(memberId);
  if (!id) return { activeSeconds: 0, idleSeconds: 0 };
  const result = await pgQuery(
    `SELECT COALESCE(SUM(s.active_seconds), 0) AS active_seconds,
            COALESCE(SUM(s.idle_seconds), 0)   AS idle_seconds
     FROM activity_sessions s
     LEFT JOIN members m ON m.id = s.member_id
     WHERE s.member_id = $1
       AND (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date >= $2::date
       AND (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date <= $3::date`,
    [id, fromDay, toDay],
  );
  const row = result?.rows?.[0] ?? {};
  return {
    activeSeconds: Math.max(0, Math.floor(Number(row.active_seconds ?? 0))),
    idleSeconds: Math.max(0, Math.floor(Number(row.idle_seconds ?? 0))),
  };
}

export async function sumMemberActiveIdleSecondsForProject(memberId, projectId, { fromDay, toDay }) {
  const id = parseProgressUuid(memberId);
  const pId = projectId ? parseProgressUuid(projectId) : null;
  if (!id || !pId) return { activeSeconds: 0, idleSeconds: 0 };
  const result = await pgQuery(
    `SELECT COALESCE(SUM(s.active_seconds), 0) AS active_seconds,
            COALESCE(SUM(s.idle_seconds), 0)   AS idle_seconds
     FROM activity_sessions s
     LEFT JOIN members m ON m.id = s.member_id
     WHERE s.member_id = $1
       AND s.project_id = $4
       AND (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date >= $2::date
       AND (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date <= $3::date`,
    [id, fromDay, toDay, pId],
  );
  const row = result?.rows?.[0] ?? {};
  return {
    activeSeconds: Math.max(0, Math.floor(Number(row.active_seconds ?? 0))),
    idleSeconds: Math.max(0, Math.floor(Number(row.idle_seconds ?? 0))),
  };
}

export async function sumDailyMemberTaskActiveSeconds(memberId, taskId, day) {
  const id = parseProgressUuid(memberId);
  const tId = taskId ? parseProgressUuid(taskId) : null;
  if (!id || !tId) return 0;
  const result = await pgQuery(
    `SELECT COALESCE(active_seconds, 0) AS total FROM daily_member_task_active_seconds
     WHERE member_id = $1 AND task_id = $2 AND day = $3::date`,
    [id, tId, day],
  );
  return Math.max(0, Math.floor(Number(result?.rows?.[0]?.total ?? 0)));
}

export async function sumDailyMemberTaskActiveSecondsRange(memberId, taskId, { fromDay, toDay }) {
  const id = parseProgressUuid(memberId);
  const tId = taskId ? parseProgressUuid(taskId) : null;
  if (!id || !tId) return 0;
  const result = await pgQuery(
    `SELECT COALESCE(SUM(active_seconds), 0) AS total FROM daily_member_task_active_seconds
     WHERE member_id = $1 AND task_id = $2 AND day >= $3::date AND day <= $4::date`,
    [id, tId, fromDay, toDay],
  );
  return Math.max(0, Math.floor(Number(result?.rows?.[0]?.total ?? 0)));
}

export async function fetchPgSessionsForDashboard(limit = 500) {
  const result = await pgQuery(
    `SELECT ${SESSION_COLUMNS} FROM activity_sessions ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return result?.rows ?? [];
}

export async function fetchAllOpenPgSessions(limit = 2000) {
  const result = await pgQuery(
    `SELECT ${SESSION_COLUMNS} FROM activity_sessions WHERE ended_at IS NULL ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return result?.rows ?? [];
}


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

export async function recordPgAlertSent(subjectMemberId, alertType, recipientIds) {
  const id = parseProgressUuid(subjectMemberId);
  if (!id) return;
  await pgQuery(
    `INSERT INTO activity_alert_log (subject_member_id, alert_type, recipient_ids, sent_at)
     VALUES ($1, $2, $3::jsonb, now())`,
    [id, alertType, JSON.stringify(recipientIds)],
  );
}


const REASSIGNABLE_TABLES = [
  { table: "activity_sessions", column: "member_id" },
  { table: "activity_screenshots", column: "member_id" },
  { table: "activity_app_logs", column: "member_id" },
  { table: "activity_url_logs", column: "member_id" },
  { table: "activity_alert_log", column: "subject_member_id" },
];

export async function reassignPgActivityMemberId(fromId, toId) {
  const from = parseProgressUuid(fromId);
  const to = parseProgressUuid(toId);
  if (!from || !to || from === to) return;
  for (const { table, column } of REASSIGNABLE_TABLES) {
    await pgQuery(`UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [from, to]);
  }
}

/**
 * Raw app-log rows for one member over a day range, in the member's own
 * timezone. Focused time needs rows rather than a GROUP BY sum: a browser
 * row's category depends on which site was open at that moment, which is a
 * per-row question the resolver answers with the URL index below.
 */
export async function fetchAppLogRowsForRangePg(memberId, { fromDay, toDay }, limit = 50000) {
  const id = parseProgressUuid(memberId);
  if (!id) return [];
  const result = await pgQuery(
    `SELECT l.session_id, a.name AS app_name, l.page_title, l.started_at, l.duration_seconds
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     LEFT JOIN members m_tz ON m_tz.id = l.member_id
     WHERE l.member_id = $1
       AND ${localDay("l.started_at")} >= $2::date
       AND ${localDay("l.started_at")} <= $3::date
     ORDER BY l.started_at
     LIMIT $4`,
    [id, fromDay, toDay, limit],
  );
  return result?.rows ?? [];
}

/**
 * URL-log rows over the same range. Used only to build the session/time index
 * that says which site a browser row was showing - never summed, because the
 * agent emits an app slice and a URL slice for the same seconds and adding
 * both counts browsing twice.
 */
export async function fetchUrlLogRowsForRangePg(memberId, { fromDay, toDay }, limit = 50000) {
  const id = parseProgressUuid(memberId);
  if (!id) return [];
  const result = await pgQuery(
    `SELECT l.session_id, l.domain, l.visited_at, l.duration_seconds
     FROM activity_url_logs l
     LEFT JOIN members m_tz ON m_tz.id = l.member_id
     WHERE l.member_id = $1
       AND l.domain IS NOT NULL AND l.domain <> ''
       AND ${localDay("l.visited_at")} >= $2::date
       AND ${localDay("l.visited_at")} <= $3::date
     ORDER BY l.visited_at
     LIMIT $4`,
    [id, fromDay, toDay, limit],
  );
  return result?.rows ?? [];
}
