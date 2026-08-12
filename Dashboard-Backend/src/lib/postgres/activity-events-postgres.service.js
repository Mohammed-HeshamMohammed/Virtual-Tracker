import { getPostgresPool } from "./client.js";
import { parseProgressUuid } from "./task-member-progress.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { normalizeAppName } from "../../modules/activity/app-name.js";
import { recordSecurityEvent } from "../../core/metrics.js";

// Allows a couple of missed 15s agent ticks (network blip, retry) before treating
// the app/tab as ended and starting a fresh row instead of extending a stale one.
const APP_LOG_MERGE_GRACE_MS = 120_000;

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
 * ACT-4: raw counters ActivityMeter::score() (Rust) is built from. Optional
 * on the wire - a web-sourced event, or an agent older than ACT-4, sends
 * none of this - so every field defaults to 0 rather than rejecting the
 * capture over a missing signal.
 * @typedef {{ keystrokeCount?: number, distinctKeyCount?: number, mouseDistancePx?: number, injectedEventCount?: number, activeSecondsInWindow?: number }} ActivitySignal
 * @param {ActivitySignal | undefined} signal
 */
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
 *   signal?: ActivitySignal,
 *   perceptualHash?: string | null,
 * }} row
 */
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
         perceptual_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      ],
    );
  } catch (err) {
    logSafeWarn("[activity-events pg screenshot]", err);
  }
}

/** Find-or-create the shared app row for this canonical name; returns its id. */
async function resolveAppId(name) {
  const result = await pgQuery(
    `INSERT INTO apps (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  );
  return result?.rows?.[0]?.id ?? null;
}

/**
 * Logs one capture tick for a session's foreground app. If the same app+tab is
 * still open in this session (last row updated within the merge grace window),
 * extends its duration instead of inserting a new row - otherwise inserts one.
 * @param {Record<string, unknown>} row
 */
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
    // Accumulate the signal into the still-open row alongside duration_seconds,
    // so a long-open app/tab carries its full session's counters, not just
    // whatever the first capture tick happened to see.
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
export async function fetchPgScreenshots(memberIds, dayFilter, limit, options = {}) {
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
  } else if (options.sinceDay) {
    // Range bound (e.g. a multi-day sparkline window) instead of an exact-day
    // match - callers needing "last N days" must pass this, not rely on a
    // plain recency LIMIT, which silently starves older days once a single
    // recent day alone exceeds `limit` rows.
    params.push(options.sinceDay);
    where += ` AND captured_at::date >= $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT id, member_id, session_id, task_id, task_title, screenshot_url,
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
    where += ` AND l.started_at::date = $${params.length}::date`;
  } else if (options.sinceDay) {
    params.push(options.sinceDay);
    where += ` AND l.started_at::date >= $${params.length}::date`;
  }
  params.push(limit);
  const result = await pgQuery(
    `SELECT l.id, l.member_id, l.session_id, l.task_id, l.task_title, a.name AS app_name, l.page_title,
            l.started_at, l.duration_seconds, l.source
     FROM activity_app_logs l
     JOIN apps a ON a.id = l.app_id
     ${where}
     ORDER BY l.started_at DESC
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

/**
 * CLS-2: total seconds per app name, one member, over a day range - grouped
 * server-side rather than fetching raw rows, since a busy member can have
 * thousands of app-log rows in a week.
 * @param {string} memberId @param {{ fromDay: string, toDay: string }} range
 */
export async function sumAppLogSecondsByAppNamePg(memberId, { fromDay, toDay }) {
  const id = parseProgressUuid(memberId);
  if (!id) return [];
  const result = await pgQuery(
    `SELECT a.name AS app_name, SUM(l.duration_seconds)::bigint AS total_seconds
     FROM activity_app_logs l JOIN apps a ON a.id = l.app_id
     WHERE l.member_id = $1 AND l.started_at::date >= $2::date AND l.started_at::date <= $3::date
     GROUP BY a.name`,
    [id, fromDay, toDay],
  );
  return result?.rows ?? [];
}

/**
 * CLS-2: total seconds per domain, one member, over a day range.
 * @param {string} memberId @param {{ fromDay: string, toDay: string }} range
 */
export async function sumUrlLogSecondsByDomainPg(memberId, { fromDay, toDay }) {
  const id = parseProgressUuid(memberId);
  if (!id) return [];
  const result = await pgQuery(
    `SELECT domain, SUM(duration_seconds)::bigint AS total_seconds
     FROM activity_url_logs
     WHERE member_id = $1 AND visited_at::date >= $2::date AND visited_at::date <= $3::date
       AND domain IS NOT NULL AND domain != ''
     GROUP BY domain`,
    [id, fromDay, toDay],
  );
  return result?.rows ?? [];
}

/**
 * CLS-3: apps seen org-wide in the last `sinceDays` days with no row (or an
 * explicit 'unclassified' row) in activity_categories, ranked by how much
 * they've actually been used - "categorise these 12 new apps your team
 * used" needs the high-volume ones surfaced first, not an alphabetical dump.
 * @param {number} [sinceDays] @param {number} [limit]
 */
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

/**
 * CLS-3: same as findUnclassifiedAppsPg, for domains.
 * @param {number} [sinceDays] @param {number} [limit]
 */
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

/** @param {string} screenshotId */
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

const SESSION_COLUMNS = "id, member_id, task_id, project_id, status, started_at, ended_at, active_seconds, idle_seconds, source, updated_at";

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
 * @param {{ id: string, memberId: string, taskId?: string|null, projectId?: string|null,
 *   status: string, startedAt: Date, endedAt?: Date|null, activeSeconds?: number,
 *   idleSeconds?: number, source?: string, updatedAt: Date }} row
 */
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

/**
 * Partial update - only the provided fields change.
 *
 * TC-4: active_seconds/idle_seconds are clamped to never regress, with one
 * deliberate exception. Without this, any request carrying a lower
 * activeSeconds than what's stored - two devices racing on the same session,
 * a slow POST landing after a later one - silently destroys recorded time.
 *
 * idle_seconds never legitimately decreases (nothing in the product rewinds
 * it), so it is always clamped up. active_seconds is clamped up UNLESS
 * `allowDecrease` is set, because the desktop agent's idle-escalation rewind
 * (tracker.rs tick_idle_escalation, posted as action "stop") *must* be able
 * to lower it - that rewind is the entire anti-fraud mechanism. Callers pass
 * `allowDecrease: true` only for that "stop" action; every other action
 * (start/resume/idle/sync) is monotonic.
 *
 * @param {string} sessionId
 * @param {{ status?: string, endedAt?: Date|null, taskId?: string|null, projectId?: string|null, activeSeconds?: number, idleSeconds?: number, updatedAt: Date }} patch
 * @param {{ allowDecrease?: boolean }} [options]
 */
export async function updatePgSession(sessionId, patch, options = {}) {
  const allowDecrease = options.allowDecrease === true;
  const wantsActive = patch.activeSeconds !== undefined;
  const wantsIdle = patch.idleSeconds !== undefined;

  // Single read backs both the clamp and the daily-rollup delta below - same
  // read-before-write shape this function already used for the delta alone,
  // now also the source of truth for "what was here before".
  let prev = null;
  if (wantsActive || wantsIdle) {
    const prevResult = await pgQuery(
      `SELECT member_id, task_id, started_at, active_seconds, idle_seconds FROM activity_sessions WHERE id = $1`,
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
          // OBS-2: "a counter on every accepted decrease... unexplained
          // should be zero once TC-4 lands" - reuses the existing /monitor
          // security-event feed rather than a new metrics system.
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
          // A decrease attempted outside the one legitimate action (stop) -
          // this is exactly the "unexplained" case OBS-2 says should be zero
          // in steady state. Recorded even though it was clamped away: the
          // attempt itself is the anomaly worth knowing about.
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
  if (wantsActive) add("active_seconds", effectiveActive);
  if (wantsIdle) add("idle_seconds", effectiveIdle);
  add("updated_at", patch.updatedAt ?? new Date());
  if (sets.length === 0) return;

  // Delta-attribute to daily rollups using the *effective* (clamped) active
  // value, not the raw request - the rollup must match what was actually
  // written, or a rejected downward write would still debit the daily total.
  if (wantsActive && prev) {
    const delta = Math.floor(effectiveActive) - Math.floor(Number(prev.active_seconds ?? 0));
    // Negative deltas are real: the desktop agent rewinds a session's active
    // seconds when it auto-stops for idling, and the rollups have to give
    // that time back too or the daily totals keep hours the session itself
    // no longer claims.
    if (delta !== 0) {
      // CQ-2: attribute to the day the session *started*, not "today" - a
      // rewind just after midnight used to take the time off a day that had
      // none, clamp at zero, and leave yesterday holding hours the session
      // no longer claims. Splitting a midnight-crossing session's delta
      // proportionally across both days is the fuller fix; attributing the
      // whole thing to the start day is the simpler one the plan calls out
      // as acceptable, and what's implemented here.
      await recordDailyActiveSecondsDelta(prev.member_id, prev.task_id, delta, prev.started_at);
    }
  }

  await pgQuery(`UPDATE activity_sessions SET ${sets.join(", ")} WHERE id = $1`, params);
}

/**
 * Applies a signed delta to the daily rollups.
 *
 * Negative deltas come from the desktop agent rewinding a session after an
 * idle auto-stop. Two things they must never do: leave a row negative, or wrap.
 * Hence GREATEST(0, ...) on both the insert and the update.
 *
 * CQ-2: attributed to the day the *session started* (falling back to today
 * if that's ever missing), not CURRENT_DATE - a rewind just after midnight
 * used to take the time off today, which had none, clamp at zero, and leave
 * yesterday holding hours the session no longer claims. This attributes the
 * whole delta to the start day rather than splitting it proportionally
 * across a midnight-crossing session - the simpler fix the plan calls out as
 * acceptable. Clamping still keeps a rewind honest (the target day floors at
 * zero) rather than pushing a row negative.
 *
 * @param {string} memberId
 * @param {string | null} taskId
 * @param {number} deltaSeconds signed; negative reverses previously counted time
 * @param {Date | string | null} [attributedTo] the session's started_at; defaults to today if absent
 */
async function recordDailyActiveSecondsDelta(memberId, taskId, deltaSeconds, attributedTo) {
  const delta = Math.trunc(Number(deltaSeconds) || 0);
  if (delta === 0) return;
  const day = attributedTo ? new Date(attributedTo) : new Date();
  const dayStr = Number.isNaN(day.getTime()) ? new Date() : day;

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
      [memberId, taskId, dayStr, delta],
    );
  }
}

/**
 * Sum of the daily rollup across [fromDay, toDay] (inclusive, 'YYYY-MM-DD') - each
 * day's row already reflects only the seconds actually worked on that calendar
 * day (see recordDailyActiveSecondsDelta), so this has no midnight-crossing bug.
 * @param {string} memberId
 * @param {{ fromDay: string, toDay: string }} range
 */
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

/**
 * @param {string} memberId
 * @param {string} taskId
 * @param {string} day 'YYYY-MM-DD'
 */
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

/**
 * Sum across [fromDay, toDay] (inclusive) instead of a single day - what
 * rolling_hour_cap tasks need so a session spanning a midnight rollover
 * (e.g. 6pm-2am) sums as one continuous stretch instead of just "today"'s
 * row. Each day's row already reflects only the seconds actually worked on
 * that calendar day (see recordDailyActiveSecondsDelta), so this has no
 * midnight-crossing bug of its own - same reasoning as sumDailyMemberActiveSeconds.
 * @param {string} memberId
 * @param {string} taskId
 * @param {{ fromDay: string, toDay: string }} range
 */
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
