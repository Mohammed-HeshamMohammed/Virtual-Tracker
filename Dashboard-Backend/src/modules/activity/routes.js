import crypto from "node:crypto";
import sharp from "sharp";
import { getSignedUrl } from "../../lib/gcs/upload.js";
import {
  getActivityCaptureMode,
  isActivityScreenshotsEnabled,
  isDesktopAgentEventIngestEnabled,
  isWebActivityCaptureEnabled,
} from "../../config/activity.js";
import { getEnv } from "../../config/env.js";
import {
  getCaptureExclusions,
  getCaptureMinimizationSettings,
  matchesExclusion,
} from "../compliance/capture-minimization.js";
import { getMemberByIdPg, updateMemberPg } from "../../lib/postgres/members-postgres.service.js";
import { getSingleByMemberId } from "../../lib/postgres/member-data-store.js";
import { recordScreenshotAccess } from "../compliance/data-retention.js";
import { getActivityScoringSettings, setActivityScoringSettings } from "./scoring-settings.js";
import { computeDHash } from "./perceptual-hash.js";
import { getSessionIntegritySummary, getMemberIntegrityFlags, contestIntegrityFlag } from "./integrity-score.js";
import { getAuthAdmin, getDb } from "../../config/firebase.js";
import { getAuthContext, isManagementRole } from "../../http/auth-context.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { readIdToken } from "../../http/auth-token.js";
import { readJsonBody, MAX_ACTIVITY_EVENTS_BODY_BYTES } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import {
  buildMemberMetaMap,
  memberOptionsFromMeta,
  resolveActivityFeedScope,
} from "./activity-scope.js";
import { maybeAlertLowActivity, maybeAlertMissingScreenshot } from "./activity-alerts.js";
import {
  newDeviceId,
  registerAgentDevice,
  revokeAgentDevice,
  revokeAgentDevicesForMember,
  verifyAgentDevice,
} from "./agent-devices.service.js";
import { assertMemberNotBanned } from "../members/services/member-ban-service.js";
import { isBrowserAppName, normalizeAppName } from "./app-name.js";
import { runContaining } from "./screenshot-run.js";
import {
  buildCategoryLookup as buildSharedCategoryLookup,
  buildUrlIndex,
  extractHttpUrl,
  parseDomain,
  resolveActivityCategory,
  siteNameFromWindowTitle,
  titleFromBrowserPageTitle,
} from "./category-resolver.js";
import {
  completeAgentLinkSession,
  createAgentLinkSession,
  exchangeAgentLinkSession,
} from "./agent-link-sessions.js";
import { canAccessTask } from "../../http/task-access.js";
import { logSafeError, logSafeWarn } from "../../http/sanitize-error.js";
import { syncTaskTimeTracking } from "../tasks/task-time-tracking.js";
import { computeAssignedTodayDemand, applyCapToAssignedTodayDemand } from "../tasks/assigned-today.service.js";
import {
  computeMemberTimerAllowance,
  computeTimerAllowance,
  currentDayRange,
  TIMER_LIMIT_REACHED_MESSAGE,
} from "../tasks/timer-limit.service.js";
import { localDayFor, weekdayIndexForLocalDay } from "../../lib/time/timezone-utils.js";
import { getMemberTimezone } from "../reports/member-timezones.js";
import { adoptReportedTimezone } from "./adopt-reported-timezone.js";
import { clientMayTrackProject, isProjectMemberForTimer } from "../../http/project-access.js";
import { isAdminLevelRole } from "../../http/role-hierarchy.js";
import { buildAgentWorkspace } from "./workspace.service.js";
import {
  getProjectPg,
  getProjectBudgetPg,
  computeProjectSpentPg,
  computeProjectBudgetTargetPg,
} from "../../lib/postgres/projects-postgres.service.js";
import { maybeNotifyProjectBudget } from "../projects/services/project-budget-notify.js";
import { isTaskLessProjectType } from "../projects/project-types.js";
import { getTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import { getAllCategories } from "../classification/activity-categories.js";
import { getMemberLimitHours, memberUsesShiftsForLimits } from "../../lib/postgres/member-data-store.js";
import {
  createPgSession,
  fetchPgAppLogs,
  fetchPgScreenshotById,
  fetchPgScreenshots,
  fetchPgSessionScreenshots,
  updatePgScreenshotActivityLevels,
  fetchPgUrlLogs,
  findOpenPgSession,
  getPgSessionById,
  insertActivityAppLog,
  insertActivityScreenshot,
  insertActivityUrlLog,
  setAppIconPg,
  getAppIconsByNamesPg,
  sumMemberActiveIdleSeconds,
  sumMemberActiveIdleSecondsForProject,
  sumAppLogSecondsByAppNameForProjectPg,
  recordSessionEventPg,
  touchPgSessionActivity,
  updatePgSession,
} from "../../lib/postgres/activity-events-postgres.service.js";
import {
  closeAbandonedSession,
  getAgentPresence,
  HEARTBEAT_TTL_SEC,
  isSessionAbandoned,
  touchAgentHeartbeat,
} from "./agent-heartbeat.js";
import { isWebActionOnAgentSession, normalizeSessionReason } from "./session-reasons.js";

async function getMemberTodayWorkStatus(db, memberId) {
  if (await memberUsesShiftsForLimits(db, memberId)) {
    return { workingToday: true, isMakeupDay: false };
  }
  const timeSettings = await getSingleByMemberId(db, "time_settings", memberId);
  const workDays = Array.isArray(timeSettings?.work_days) ? timeSettings.work_days : [0, 1, 2, 3, 4];
  const makeupDays = Array.isArray(timeSettings?.makeup_days) ? timeSettings.makeup_days : [];
  // The member's own calendar, not the server's - they can be a day apart.
  const memberTimeZone = await getMemberTimezone(memberId);
  const today = weekdayIndexForLocalDay(localDayFor(new Date(), memberTimeZone));
  const isMakeupDay = makeupDays.includes(today);
  return { workingToday: isMakeupDay || workDays.includes(today), isMakeupDay };
}

async function checkProjectBudgetCap(db, projectId) {
  const budget = await getProjectBudgetPg(projectId);
  if (!budget) return null;
  const spent = await computeProjectSpentPg(db, projectId, budget);
  const cap = await computeProjectBudgetTargetPg(db, projectId, budget);
  const usagePct = cap > 0 ? (spent / cap) * 100 : 0;
  const reached =
    budget.stop_timers_when_reached === true &&
    budget.stop_timers_at_pct != null &&
    usagePct >= Number(budget.stop_timers_at_pct);
  return { budget, spent, cap, reached };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function readActivitySignal(ev) {
  return {
    keystrokeCount: ev.keystrokeCount,
    distinctKeyCount: ev.distinctKeyCount,
    mouseDistancePx: ev.mouseDistancePx,
    injectedEventCount: ev.injectedEventCount,
    activeSecondsInWindow: ev.activeSecondsInWindow,
  };
}

/** URL rows fetched purely to build the matching index. Higher than the
 *  feeds' own 500-row page because one app row can need any URL row in its
 *  session to resolve; an unmatched row still falls back to the window title,
 *  so a short read degrades gracefully rather than mis-categorising. */
const URL_INDEX_LIMIT = 2000;

/** Category holding the most seconds; "unclassified" when there is nothing to
 *  weigh. Non-browser apps only ever accumulate one category, so this returns
 *  exactly what a direct lookup would for them. */
function dominantCategory(categorySeconds) {
  let best = null;
  let bestSeconds = 0;
  for (const [category, seconds] of Object.entries(categorySeconds ?? {})) {
    if (seconds > bestSeconds) {
      best = category;
      bestSeconds = seconds;
    }
  }
  return best ?? "unclassified";
}

async function buildCategoryLookup() {
  // Categories resolve at read time, so re-classifying an app changes what
  // past periods report. That is correct - a classification is a statement
  // about what something *is* - but it is surprising when two exports of the
  // same period disagree with nothing explaining why. Reporting when the
  // classifications last changed lets the UI say so instead of silently
  // moving the numbers.
  let rows = [];
  let updatedAt = null;
  try {
    rows = await getAllCategories();
    for (const row of rows) {
      const rowUpdated = toIso(row.updatedAt);
      if (rowUpdated && (!updatedAt || rowUpdated > updatedAt)) updatedAt = rowUpdated;
    }
  } catch (err) {
    logSafeWarn("[activity/feed] classification lookup failed", err);
  }
  // No role passed: this feed is shared across viewers, so it resolves the
  // base category rather than any one role's override.
  return { lookup: buildSharedCategoryLookup(rows), updatedAt };
}

// These four moved to category-resolver.js so the resolver and the feeds
// share one implementation. Re-exported here because that is where callers
// (and test/activity-window-title-site-name.test.js) already import them from.
export { titleFromBrowserPageTitle, siteNameFromWindowTitle };

const MANAGER_TRACKING_DISABLED_MESSAGE =
  "Time tracking on this project has been turned off for managers. Contact an admin or owner.";

function isManagerRoleName(roleName) {
  return String(roleName || "").trim().toLowerCase().replace(/\s+/g, "") === "manager";
}

async function resolveMember(db, req) {
  const viewer = getAuthContext(req);
  if (!viewer) return null;
  const data = (await getMemberByIdPg(viewer.memberId)) || {};
  const first = typeof data.first_name === "string" ? data.first_name : "";
  const last = typeof data.last_name === "string" ? data.last_name : "";
  const name = `${first} ${last}`.trim() || (typeof data.name === "string" ? data.name : "") || "Unknown";
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  return { memberId: viewer.memberId, uid: viewer.uid, name, initials };
}

async function findOpenSession(memberId) {
  const open = await findOpenPgSession(memberId);
  if (!open) return null;
  if (await isSessionAbandoned(open)) {
    await closeAbandonedSession(open);
    return null;
  }
  return open;
}

export function isOneOpenSessionConflict(err) {
  return (
    err instanceof Object &&
 (err).code === "23505" &&
 (err).constraint ===
      "activity_sessions_one_open_per_member"
  );
}

async function normalizeSession(id, data) {
  let disableIdleTime;
  let idleTimeSeconds;
  if (!data.task_id && data.project_id) {
    const project = await getProjectPg(data.project_id).catch(() => null);
    disableIdleTime = Boolean(project?.disable_idle_time ?? false);
    idleTimeSeconds = Number(project?.idle_time_seconds ?? 450);
  }
  return {
    id,
    memberId: data.member_id,
    status: data.status,
    startedAt: toIso(data.started_at),
    endedAt: toIso(data.ended_at),
    activeSeconds: typeof data.active_seconds === "number" ? data.active_seconds : 0,
    idleSeconds: typeof data.idle_seconds === "number" ? data.idle_seconds : 0,
    taskId: data.task_id ?? null,
    projectId: data.project_id ?? null,
    updatedAt: toIso(data.updated_at),
    // Who owns the session ("agent" or "web"), and why it last paused - so a
    // client can tell a session it must leave alone from one it may drive.
    source: data.source ?? null,
    pauseReason: data.pause_reason ?? null,
    screenshotsEnabled: isActivityScreenshotsEnabled(),
    ...(disableIdleTime !== undefined ? { disableIdleTime, idleTimeSeconds } : {}),
  };
}

/**
 * The agent's presence for the status endpoint: online, offline, or unknown.
 *
 * `agentOnline` stays for older dashboards, but is now `null` - not `false` -
 * when we cannot tell. A dashboard that reads false pauses the timer, and
 * "Redis cannot answer" is not evidence the agent has gone (R1 in
 * PLAN-timer-stop-resilience.md). When Redis cannot answer, the session row is
 * a second witness: the agent's poll and sync both touch it, so a recent
 * `updated_at` on an agent session means the agent is there.
 */
async function describeAgentPresence(memberId) {
  const { presence, lastSeenAt } = await getAgentPresence(memberId);
  if (presence !== "unknown") {
    return { agentOnline: presence === "online", agentPresence: presence, agentLastSeenAt: lastSeenAt };
  }
  const open = await findOpenPgSession(memberId).catch(() => null);
  const source = String(open?.source ?? "").toLowerCase();
  if (open?.updated_at && (source === "agent" || source === "desktop_agent")) {
    const seen = new Date(open.updated_at).getTime();
    if (Number.isFinite(seen) && Date.now() - seen <= HEARTBEAT_TTL_SEC * 1000) {
      return { agentOnline: true, agentPresence: "online", agentLastSeenAt: new Date(seen).toISOString() };
    }
  }
  return { agentOnline: null, agentPresence: "unknown", agentLastSeenAt: null };
}

export async function routeActivity(req, res, url, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (!pn.startsWith("/api/activity")) return false;

  const auth = getAuthAdmin();
  const db = getDb();
  if (!auth || !db) {
    sendJson(res, origin, 503, { success: false, error: "Firebase is not configured." });
    return true;
  }

  if (pn === "/api/activity/session" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      if (!origin) void touchAgentHeartbeat(member.memberId);
      const open = await findOpenSession(member.memberId);
      // The agent polling for its own session is the freshest proof it is
      // still there. Without this the only thing moving `updated_at` was a
      // sync POST, and the abandoned-session sweep closed sessions out from
      // under agents that were plainly alive - see touchPgSessionActivity.
      // Agent requests only (`!origin`): a dashboard tab watching the same
      // member must not keep a genuinely dead session open.
      if (!origin && open?.id) void touchPgSessionActivity(open.id);
      sendJson(res, origin, 200, {
        success: true,
        data: open ? await normalizeSession(open.id, open) : null,
      });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  if (pn === "/api/activity/limits" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const { todayDay } = currentDayRange(await getMemberTimezone(member.memberId));
      const projectId = (url.searchParams.get("projectId") || "").trim();
      const [
        dailyHours,
        weeklyHours,
        usesShifts,
        timerAllowance,
        assignedDemand,
        todayWorkStatus,
        todayActivity,
        projectTodayActivity,
      ] = await Promise.all([
        getMemberLimitHours(db, member.memberId, "daily"),
        getMemberLimitHours(db, member.memberId, "weekly"),
        memberUsesShiftsForLimits(db, member.memberId),
        computeMemberTimerAllowance(db, member.memberId),
        computeAssignedTodayDemand(member.memberId),
        getMemberTodayWorkStatus(db, member.memberId),
        sumMemberActiveIdleSeconds(member.memberId, { fromDay: todayDay, toDay: todayDay }),
        projectId
          ? sumMemberActiveIdleSecondsForProject(member.memberId, projectId, { fromDay: todayDay, toDay: todayDay })
          : null,
      ]);
      const capLeftToday = usesShifts ? null : timerAllowance.allowedRemainingSeconds;
      // `total` is the whole open workload, not a property of today, so it
      // travels as its own field rather than nested under assignedToday.
      const { total: assignedTotal, ...assignedToday } = applyCapToAssignedTodayDemand(
        assignedDemand,
        capLeftToday,
      );
      sendJson(res, origin, 200, {
        success: true,
        data: {
          dailyHours,
          weeklyHours,
          usesShifts,
          timerAllowance,
          assignedToday,
          assignedTotal,
          workingToday: todayWorkStatus.workingToday,
          isMakeupDay: todayWorkStatus.isMakeupDay,
          todayActivity,
          projectTodayActivity,
        },
      });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  if (pn === "/api/activity/workspace" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const data = await buildAgentWorkspace(db, {
        memberId: member.memberId,
        roleName: getAuthContext(req)?.roleName ?? "",
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[activity/workspace]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load workspace." });
    }
    return true;
  }

  if (pn === "/api/activity/my-screenshots" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 12;
      const projectId = (url.searchParams.get("projectId") || "").trim() || null;
      const rows = await fetchPgScreenshots([member.memberId], null, limit, { projectId });
      sendJson(res, origin, 200, {
        success: true,
        data: rows.map((row) => ({
          id: String(row.id ?? ""),
          capturedAt: row.captured_at ?? row.capturedAt ?? null,
        })),
      });
    } catch (e) {
      logSafeError("[activity/my-screenshots]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load screenshots." });
    }
    return true;
  }

  if (pn === "/api/activity/project-app-breakdown" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    const projectId = (url.searchParams.get("projectId") || "").trim();
    if (!projectId) {
      sendJson(res, origin, 400, { success: false, error: "projectId is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const { todayDay, weekStartDay } = currentDayRange(await getMemberTimezone(member.memberId));
      const { apps, totalSeconds, appCount } = await sumAppLogSecondsByAppNameForProjectPg(
        member.memberId,
        projectId,
        { fromDay: weekStartDay, toDay: todayDay },
      );
      const shown = apps.map((row) => ({
        appName: String(row.app_name ?? ""),
        totalSeconds: Math.max(0, Math.floor(Number(row.total_seconds ?? 0))),
      }));
      sendJson(res, origin, 200, {
        success: true,
        // The panel shows a handful of apps; without the totals it had no way
        // to say so, and the times it did show visibly failed to add up to the
        // week beside them.
        data: {
          apps: shown,
          totalSeconds,
          appCount,
          shownSeconds: shown.reduce((sum, app) => sum + app.totalSeconds, 0),
        },
      });
    } catch (e) {
      logSafeError("[activity/project-app-breakdown]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load this project's app breakdown." });
    }
    return true;
  }

  if (pn === "/api/activity/session" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    const activeSeconds = typeof body.activeSeconds === "number" ? Math.max(0, Math.floor(body.activeSeconds)) : undefined;
    const idleSeconds = typeof body.idleSeconds === "number" ? Math.max(0, Math.floor(body.idleSeconds)) : undefined;
    const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : null;
    const bodyProjectId =
      typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;
    const stopNote =
      typeof body.stopNote === "string" && body.stopNote.trim()
        ? body.stopNote.trim().slice(0, 1000)
        : null;
    const reportedTimeZone =
      typeof body.timeZone === "string" && body.timeZone.trim()
        ? body.timeZone.trim().slice(0, 64)
        : null;
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
  const allowed = new Set(["start", "idle", "resume", "stop", "sync"]);
    if (!allowed.has(action)) {
      sendJson(res, origin, 400, { success: false, error: "action must be start, idle, resume, stop, or sync" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      // The agent's sync (every ~20s) is proof it is alive just as much as its
      // session poll is. The poll used to be the heartbeat's only writer, so any
      // gap in polling read as the agent going offline - see HEARTBEAT_TTL_SEC.
      // Agent requests only: a dashboard tab starting a timer must not make an
      // agent that is not running look online.
      if (!origin) void touchAgentHeartbeat(member.memberId);

      if (
        (action === "start" || action === "resume") &&
        getActivityCaptureMode() === "agent" &&
        isDesktopAgentEventIngestEnabled()
      ) {
        const memberRow = (await getMemberByIdPg(member.memberId)) || {};
        if (!memberRow.desktop_agent_linked_at) {
          sendJson(res, origin, 409, {
            success: false,
            error: "Link the Virtual Tracker desktop agent to your account before starting the timer.",
          });
          return true;
        }
      }

      // Before anything reads this member's day boundary below, give them one
      // if they have none - otherwise an agent-only member is stuck on UTC and
      // every day-based decision that follows is made against the wrong
      // calendar.
      await adoptReportedTimezone(member.memberId, reportedTimeZone);

      const now = new Date();
      let open = await findOpenSession(member.memberId);

      // Every session action says why it happened, and from where
      // (PLAN-timer-stop-resilience.md D2). Old agents send no reason; that is
      // recorded as "unspecified", never rejected.
      const fromWeb = Boolean(origin);
      const sessionReason = normalizeSessionReason(body.reason);
      const clientVersion =
        typeof req.headers?.["x-agent-version"] === "string" ? req.headers["x-agent-version"].slice(0, 40) : null;
      const sessionBefore = open;

      // The agent owns an agent session. A dashboard tab - including one still
      // running the old code, which paused on a single "offline" reading and
      // stopped on sign-out - may not pause, stop, resume or overwrite it. The
      // refusal is answered with the session as it stands (200, so old clients
      // do not error) and recorded, so it shows up in the history.
      if (open && isWebActionOnAgentSession({ sessionSource: open.source, requestFromWeb: fromWeb, action })) {
        // Recorded for pause, stop and resume only. A tab on the old code also
        // syncs every few seconds; a row per refused sync would drown the
        // history the events table exists to make readable.
        if (action !== "sync") {
          void recordSessionEventPg({
            sessionId: open.id,
            action: "ignored",
            reason: "web_on_agent_session",
            actorId: member.memberId,
            source: "web",
            clientVersion,
          });
          logSafeWarn("[activity/session] refused a dashboard action on an agent-owned session", {
            sessionId: open.id,
            action,
            requestedReason: sessionReason,
          });
        }
        sendJson(res, origin, 200, { success: true, data: await normalizeSession(open.id, open) });
        return true;
      }

      let sessionProjectId = bodyProjectId || open?.project_id || null;

      if (action === "start" || action === "resume") {
        const effectiveTaskId = taskId || open?.task_id || null;
        const cumulativeActiveSeconds = Math.max(0, Math.floor(activeSeconds ?? 0));
        const viewer = getAuthContext(req);

        const timeSettings = await getSingleByMemberId(db, "time_settings", member.memberId);
        if (timeSettings?.able_to_track_time === false) {
          sendJson(res, origin, 403, {
            success: false,
            error: "Time tracking is disabled for this member.",
          });
          return true;
        }

        // Gate starting a session only - never resuming one.
        //
        // A shift that legitimately began on a working day stays valid for
        // its whole life, including the part that runs past midnight into a
        // weekend or holiday (those hours book back to the working day it
        // started on, so the rest day still records nothing). Re-checking on
        // "resume" meant taking a break at 11:55pm on the last working day
        // and being refused at 12:05am - locked out of a shift already
        // underway. The day is resolved in the member's own timezone, since
        // "is today a working day" is a question about their calendar, not
        // the server's.
        if (action === "start" && !(await memberUsesShiftsForLimits(db, member.memberId))) {
          const workDays = Array.isArray(timeSettings?.work_days) ? timeSettings.work_days : [0, 1, 2, 3, 4];
          const makeupDays = Array.isArray(timeSettings?.makeup_days) ? timeSettings.makeup_days : [];
          const memberTimeZone = await getMemberTimezone(member.memberId);
          const today = weekdayIndexForLocalDay(localDayFor(now, memberTimeZone));
          if (!workDays.includes(today) && !makeupDays.includes(today)) {
            sendJson(res, origin, 403, {
              success: false,
              error: "Today is not a scheduled working day for this member.",
            });
            return true;
          }
        }

        if (effectiveTaskId) {
          const task = await getTaskPg(effectiveTaskId);
          if (task) {
            sessionProjectId = task.project_id ?? sessionProjectId;
            if (sessionProjectId && isManagerRoleName(viewer?.roleName)) {
              const gateProject = await getProjectPg(sessionProjectId);
              if (gateProject && gateProject.allow_project_tracking === false) {
                sendJson(res, origin, 403, { success: false, error: MANAGER_TRACKING_DISABLED_MESSAGE });
                return true;
              }
            }
            const allowance = await computeTimerAllowance(db, member.memberId, task, {
              currentCumulativeActiveSeconds: cumulativeActiveSeconds,
            });
            if (allowance.limitReached) {
              sendJson(res, origin, 403, {
                success: false,
                error: allowance.message || TIMER_LIMIT_REACHED_MESSAGE,
                data: { timerAllowance: allowance },
              });
              return true;
            }
          }
        } else {
          if (!sessionProjectId) {
            sendJson(res, origin, 400, {
              success: false,
              error: "taskId or projectId is required to start a timer",
            });
            return true;
          }
          const project = await getProjectPg(sessionProjectId);
          if (!project) {
            sendJson(res, origin, 404, { success: false, error: "Project not found" });
            return true;
          }
          const allowsTaskLessTimer =
            isTaskLessProjectType(project.type) ||
            project.require_task_to_track === false ||
            isAdminLevelRole(viewer?.roleName ?? "") ||
            (await clientMayTrackProject({ memberId: member.memberId, roleName: viewer?.roleName ?? "" }, sessionProjectId));
          if (!allowsTaskLessTimer) {
            sendJson(res, origin, 400, {
              success: false,
              error: "This project tracks time against tasks - select a task to start the timer.",
            });
            return true;
          }
          if (isManagerRoleName(viewer?.roleName) && project.allow_project_tracking === false) {
            sendJson(res, origin, 403, { success: false, error: MANAGER_TRACKING_DISABLED_MESSAGE });
            return true;
          }
          const canTime = await isProjectMemberForTimer(
            db,
            { memberId: member.memberId, roleName: viewer?.roleName ?? "" },
            sessionProjectId,
          );
          if (!canTime) {
            sendJson(res, origin, 403, {
              success: false,
              error: "You are not assigned to this project.",
            });
            return true;
          }
          const allowance = await computeMemberTimerAllowance(db, member.memberId, {
            currentCumulativeActiveSeconds: cumulativeActiveSeconds,
            projectId: sessionProjectId,
          });
          if (allowance.limitReached) {
            sendJson(res, origin, 403, {
              success: false,
              error: allowance.message || TIMER_LIMIT_REACHED_MESSAGE,
              data: { timerAllowance: allowance },
            });
            return true;
          }
        }

        if (sessionProjectId) {
          const budgetCheck = await checkProjectBudgetCap(db, sessionProjectId);
          if (budgetCheck?.reached) {
            sendJson(res, origin, 403, {
              success: false,
              error: "This project's budget has been reached - timers are stopped for this project.",
            });
            return true;
          }
          if (budgetCheck) {
            maybeNotifyProjectBudget(db, sessionProjectId, budgetCheck.budget, budgetCheck.spent, budgetCheck.cap).catch(
              () => null,
            );
          }
        }
      }

      if (action === "start") {
        if (!open) {
          const id = crypto.randomUUID();
          try {
            open = await createPgSession({
              id,
              memberId: member.memberId,
              taskId,
              projectId: sessionProjectId,
              status: "active",
              startedAt: now,
              endedAt: null,
              activeSeconds: activeSeconds ?? 0,
              idleSeconds: idleSeconds ?? 0,
              source: origin ? "web" : "agent",
              updatedAt: now,
            });
          } catch (createErr) {
            if (isOneOpenSessionConflict(createErr)) {
              sendJson(res, origin, 409, {
                success: false,
                error: "You already have a timer running on another device.",
              });
              return true;
            }
            throw createErr;
          }
        } else if (open.status !== "active") {
          await updatePgSession(open.id, {
            status: "active",
            updatedAt: now,
            ...(taskId ? { taskId } : {}),
            ...(sessionProjectId ? { projectId: sessionProjectId } : {}),
            ...(activeSeconds !== undefined ? { activeSeconds } : {}),
            ...(idleSeconds !== undefined ? { idleSeconds } : {}),
          });
          open.status = "active";
        }
      } else if (action === "idle") {
        if (open) {
          await updatePgSession(open.id, {
            status: "idle",
            updatedAt: now,
            pauseReason: sessionReason,
            pausedAt: now,
            ...(taskId ? { taskId } : {}),
            ...(sessionProjectId ? { projectId: sessionProjectId } : {}),
            ...(activeSeconds !== undefined ? { activeSeconds } : {}),
            ...(idleSeconds !== undefined ? { idleSeconds } : {}),
          });
          open.status = "idle";
        }
      } else if (action === "resume") {
        if (open) {
          await updatePgSession(open.id, {
            status: "active",
            updatedAt: now,
            ...(taskId ? { taskId } : {}),
            ...(sessionProjectId ? { projectId: sessionProjectId } : {}),
            ...(activeSeconds !== undefined ? { activeSeconds } : {}),
            ...(idleSeconds !== undefined ? { idleSeconds } : {}),
          });
          open.status = "active";
        } else {
          const id = crypto.randomUUID();
          try {
            open = await createPgSession({
              id,
              memberId: member.memberId,
              taskId,
              projectId: sessionProjectId,
              status: "active",
              startedAt: now,
              endedAt: null,
              activeSeconds: activeSeconds ?? 0,
              idleSeconds: idleSeconds ?? 0,
              source: origin ? "web" : "agent",
              updatedAt: now,
            });
          } catch (createErr) {
            if (isOneOpenSessionConflict(createErr)) {
              sendJson(res, origin, 409, {
                success: false,
                error: "You already have a timer running on another device.",
              });
              return true;
            }
            throw createErr;
          }
        }
      } else if (action === "stop") {
        if (open) {
          await updatePgSession(
            open.id,
            {
              status: "stopped",
              endedAt: now,
              updatedAt: now,
              stopReason: sessionReason,
              stoppedBy: member.memberId,
              ...(stopNote ? { stopNote } : {}),
              ...(activeSeconds !== undefined ? { activeSeconds } : {}),
              ...(idleSeconds !== undefined ? { idleSeconds } : {}),
            },
            { allowDecrease: true },
          );
          open = null;
        }
      } else if (action === "sync" && open) {
        await updatePgSession(open.id, {
          updatedAt: now,
          ...(taskId ? { taskId } : {}),
          ...(sessionProjectId ? { projectId: sessionProjectId } : {}),
          ...(activeSeconds !== undefined ? { activeSeconds } : {}),
          ...(idleSeconds !== undefined ? { idleSeconds } : {}),
        });
      }

      // History for every state change; syncs (every ~20s) would drown it.
      if (action !== "sync") {
        const eventSessionId = open?.id ?? sessionBefore?.id ?? null;
        if (eventSessionId) {
          void recordSessionEventPg({
            sessionId: eventSessionId,
            action,
            reason: sessionReason,
            actorId: member.memberId,
            source: fromWeb ? "web" : "agent",
            clientVersion,
          });
        }
      }

      const syncTaskId = taskId || open?.task_id || null;
      let timerCapped = false;
      if (syncTaskId && activeSeconds !== undefined && idleSeconds !== undefined) {
        const viewer = getAuthContext(req);
        const taskAccess = await canAccessTask(
          db,
          member.memberId,
          viewer?.roleName ?? "",
          syncTaskId,
        );
        if (!taskAccess.allowed) {
          sendJson(res, origin, taskAccess.status, { success: false, error: "Not found." });
          return true;
        }
        try {
          const syncResult = await syncTaskTimeTracking(db, {
            taskId: syncTaskId,
            userId: member.memberId,
            userName: member.name,
            action,
            activeSeconds,
            idleSeconds,
            sessionId: open?.id ?? null,
          });
          timerCapped = syncResult?.timerCapped === true;
        } catch (syncErr) {
          logSafeError("[activity/session task sync]", syncErr);
        }
      }

      let budgetCapped = false;
      if (sessionProjectId) {
        try {
          const budgetCheck = await checkProjectBudgetCap(db, sessionProjectId);
          budgetCapped = budgetCheck?.reached === true;
        } catch (budgetErr) {
          logSafeError("[activity/session budget sync]", budgetErr);
        }
      }

      sendJson(res, origin, 200, {
        success: true,
        data: open ? { ...(await normalizeSession(open.id, open)), timerCapped, budgetCapped } : null,
      });
    } catch (e) {
      logSafeError("[activity/session POST]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Session update failed" });
    }
    return true;
  }

  if (pn === "/api/activity/events" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req, MAX_ACTIVITY_EVENTS_BODY_BYTES);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const events = Array.isArray(body.events) ? body.events : [];
    if (!idToken || !sessionId) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token and sessionId are required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const sessionData = await getPgSessionById(sessionId);
      if (!sessionData || String(sessionData.member_id) !== member.memberId) {
        sendJson(res, origin, 404, { success: false, error: "Session not found" });
        return true;
      }

      const sessionTaskId = typeof sessionData.task_id === "string" ? sessionData.task_id : null;
      let sessionTaskTitle = null;
      if (sessionTaskId) {
        const sessionTask = await getTaskPg(sessionTaskId);
        const title = sessionTask?.title;
        sessionTaskTitle = typeof title === "string" && title.trim() ? title.trim() : null;
      }

      const source = typeof body.source === "string" ? body.source : "web";
      if (source === "agent" && !isDesktopAgentEventIngestEnabled()) {
        sendJson(res, origin, 200, {
          success: true,
          data: { inserted: 0, skipped: "desktop_agent_ingest_disabled" },
        });
        return true;
      }

      const now = new Date();
      let count = 0;
      const screenshotWrites = [];

      const [minimizationSettings, exclusions] = await Promise.all([
        getCaptureMinimizationSettings(),
        getCaptureExclusions(),
      ]);

      for (const ev of events.slice(0, 50)) {
        if (!ev || typeof ev !== "object") continue;
        const type = typeof ev.type === "string" ? ev.type : "";
        const id = crypto.randomUUID();

        if (type === "screenshot") {
          if (source === "agent" && !isDesktopAgentEventIngestEnabled()) continue;
          if (source !== "agent" && !isWebActivityCaptureEnabled()) continue;
          const appName = typeof ev.appName === "string" ? ev.appName.slice(0, 200) : "Browser";
          if (matchesExclusion(exclusions, "app", appName)) continue;
          const imageData =
            typeof ev.imageData === "string"
              ? ev.imageData
              : typeof ev.image_data === "string"
                ? ev.image_data
                : "";
          if (!imageData) continue;
          if (imageData.length > 2_300_000) {
            logSafeWarn("[activity events] screenshot dropped: oversized", {
              memberId: member.memberId,
              sessionId,
              bytes: imageData.length,
            });
            continue;
          }
          screenshotWrites.push(
            (async () => {
              try {
                const raw = imageData.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "");
                const buffer = Buffer.from(raw, "base64");
                let pipeline = sharp(buffer).resize({
                  width: 1280,
                  height: 720,
                  fit: "inside",
                  withoutEnlargement: true,
                });
                if (minimizationSettings.screenshotBlurDefault) {
                  pipeline = pipeline.blur(18);
                }
                const webp = await pipeline.webp({ quality: 75 }).toBuffer();
                const capturedAt = ev.captured_at ? new Date(ev.captured_at) : now;
                let perceptualHash = null;
                try {
                  perceptualHash = await computeDHash(buffer);
                } catch (hashErr) {
                  logSafeWarn("[activity events] perceptual hash failed", hashErr);
                }
                // A capture's URL goes through the SAME privacy gates as a URL
                // event: the domain-only minimiser and the exclusion list.
                // This is not new collection - it is the URL the agent
                // already sends, attached to the capture - and it must not
                // become new collection by bypassing either gate.
                const shotUrlRaw = typeof ev.url === "string" ? ev.url.slice(0, 2000) : "";
                const shotDomain = shotUrlRaw ? parseDomain(shotUrlRaw) : "";
                const shotExcluded = shotDomain && matchesExclusion(exclusions, "domain", shotDomain);
                const shotUrl = shotExcluded
                  ? ""
                  : minimizationSettings.urlDomainOnly
                    ? shotDomain
                    : shotUrlRaw;

                await insertActivityScreenshot({
                  id,
                  url: shotUrl || null,
                  domain: shotExcluded ? null : shotDomain || null,
                  memberId: member.memberId,
                  sessionId,
                  taskId: sessionTaskId,
                  taskTitle: sessionTaskTitle,
                  imageData: webp,
                  appName,
                  pageTitle: typeof ev.pageTitle === "string" ? ev.pageTitle.slice(0, 300) : "",
                  activityLevel:
                    typeof ev.activityLevel === "number"
                      ? Math.max(0, Math.min(100, Math.floor(ev.activityLevel)))
                      : 50,
                  capturedAt,
                  source,
                  signal: readActivitySignal(ev),
                  perceptualHash,
                });
                count++;
              } catch (err) {
                logSafeWarn("[activity events] screenshot insert failed", err);
              }
            })(),
          );
          continue;
        }
        if (type === "app") {
          const appName = typeof ev.appName === "string" ? ev.appName.slice(0, 200) : "Unknown";
          if (matchesExclusion(exclusions, "app", appName)) continue;
          const appRow = {
            id,
            memberId: member.memberId,
            sessionId,
            taskId: sessionTaskId,
            taskTitle: sessionTaskTitle,
            appName,
            pageTitle: typeof ev.pageTitle === "string" ? ev.pageTitle.slice(0, 300) : "",
            startedAt: now,
            durationSeconds: typeof ev.durationSeconds === "number" ? ev.durationSeconds : 30,
            source: typeof body.source === "string" ? body.source : "web",
            signal: readActivitySignal(ev),
          };
          await insertActivityAppLog(appRow);
          // Icon rides an app slice at most once per app per agent run.
          const appIcon = typeof ev.appIcon === "string" ? ev.appIcon : "";
          if (source === "agent" && appIcon.startsWith("data:image/") && appIcon.length <= 20000) {
            void setAppIconPg(appName, appIcon).catch((err) =>
              logSafeWarn("[activity events] app icon store failed", err),
            );
          }
          count++;
        } else if (type === "url") {
          const rawUrlStr = typeof ev.url === "string" ? ev.url.slice(0, 2000) : "";
          const domain = parseDomain(rawUrlStr);
          if (matchesExclusion(exclusions, "domain", domain)) continue;
          const urlStr = minimizationSettings.urlDomainOnly ? domain || "" : rawUrlStr;
          const urlRow = {
            id,
            memberId: member.memberId,
            sessionId,
            taskId: sessionTaskId,
            taskTitle: sessionTaskTitle,
            url: urlStr,
            domain,
            pageTitle: typeof ev.pageTitle === "string" ? ev.pageTitle.slice(0, 300) : "",
            visitedAt: now,
            durationSeconds: typeof ev.durationSeconds === "number" ? ev.durationSeconds : 30,
            source: typeof body.source === "string" ? body.source : "web",
          };
          void insertActivityUrlLog(urlRow);
          count++;
        }
      }

      if (screenshotWrites.length) await Promise.all(screenshotWrites);

      const hadScreenshot = events.some((ev) => ev && typeof ev === "object" && ev.type === "screenshot");
      const hadAppOnly = events.some((ev) => ev && typeof ev === "object" && ev.type === "app");
      if (hadScreenshot) {
        for (const ev of events) {
          if (ev?.type === "screenshot" && typeof ev.activityLevel === "number") {
            void maybeAlertLowActivity(db, member.memberId, sessionId, ev.activityLevel).catch(() => {});
          }
        }
      } else if (hadAppOnly) {
        void maybeAlertMissingScreenshot(db, member.memberId, sessionId).catch(() => {});
      }

      sendJson(res, origin, 200, { success: true, data: { inserted: count } });
    } catch (e) {
      logSafeWarn("[activity events] ingest failed", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Event ingest failed" });
    }
    return true;
  }

  if (pn === "/api/activity/scope" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const projectScopeOnly = url.searchParams.get("projectScopeOnly") === "true";
      const scope = await resolveActivityFeedScope(db, member.memberId, { projectScopeOnly });
      const memberMeta = await buildMemberMetaMap(db, scope.allowedMemberIds);
      const members = memberOptionsFromMeta(scope.allowedMemberIds, memberMeta, member.memberId);
      sendJson(res, origin, 200, {
        success: true,
        data: {
          viewerMemberId: member.memberId,
          roleName: scope.roleName,
          canFilterByProject: scope.canFilterByProject,
          canSeeAllMembers: scope.canSeeAllMembers,
          projectScopeOnly: scope.projectScopeOnly,
          members,
          defaultMemberId: scope.canSeeAllMembers ? "all" : member.memberId,
        },
      });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Scope failed" });
    }
    return true;
  }

  if (pn.startsWith("/api/activity/screenshot/") && req.method === "GET") {
    const idToken = readIdToken(req, url);
    const screenshotId = pn.slice("/api/activity/screenshot/".length).split("/")[0];
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    if (!screenshotId) {
      sendJson(res, origin, 400, { success: false, error: "Screenshot id is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }

      const pgRow = await fetchPgScreenshotById(screenshotId);
      if (!pgRow) {
        sendJson(res, origin, 404, { success: false, error: "Screenshot not found" });
        return true;
      }
      const ownerId = String(pgRow.member_id ?? "");
      const screenshotPath = typeof pgRow.screenshot_url === "string" ? pgRow.screenshot_url : "";
      const imageBytes = pgRow.image_data ?? null;
      const resolvedId = String(pgRow.id ?? screenshotId);

      const scope = await resolveActivityFeedScope(db, member.memberId, { memberId: ownerId });
      if (scope.forbidden) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to view this screenshot" });
        return true;
      }

      void recordScreenshotAccess({
        screenshotId: resolvedId,
        screenshotOwner: ownerId,
        readerMemberId: member.memberId,
      }).catch((err) => logSafeWarn("[activity/screenshot access log]", err));

      let imageUrl = "";
      if (imageBytes) {
        imageUrl = `data:image/webp;base64,${Buffer.from(imageBytes).toString("base64")}`;
      } else if (screenshotPath) {
        imageUrl = await getSignedUrl(screenshotPath, 15);
      }
      sendJson(res, origin, 200, {
        success: true,
        data: { id: resolvedId, imageData: imageUrl, screenshotUrl: imageUrl },
      });
    } catch (e) {
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Screenshot load failed" });
    }
    return true;
  }

  // Correct a capture's activity level. Applies across its capture run - the
  // unbroken stretch of tracked work it belongs to - because a wrong reading
  // is almost never wrong for exactly one screenshot. Idle gaps bound it; see
  // screenshot-run.js for why a gap is a reliable idle signal.
  if (pn.startsWith("/api/activity/screenshot/") && pn.endsWith("/activity") && req.method === "PATCH") {
    const idToken = readIdToken(req, url);
    const screenshotId = pn.slice("/api/activity/screenshot/".length).split("/")[0];
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    if (!screenshotId) {
      sendJson(res, origin, 400, { success: false, error: "Screenshot id is required" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, origin, 400, { success: false, error: "Invalid JSON body" });
      return true;
    }
    const rawLevel = Number(body?.activityLevel);
    if (!Number.isFinite(rawLevel) || rawLevel < 0 || rawLevel > 100) {
      sendJson(res, origin, 400, {
        success: false,
        error: "activityLevel must be a number between 0 and 100",
      });
      return true;
    }
    const activityLevel = Math.floor(rawLevel);
    const applyToRun = body?.applyToRun !== false;
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      // Same gate as deleting a screenshot - no new permission concept.
      if (!isManagementRole(getAuthContext(req)?.roleName ?? "")) {
        sendJson(res, origin, 403, {
          success: false,
          error: "Insufficient permissions to edit screenshot activity.",
        });
        return true;
      }

      const pgRow = await fetchPgScreenshotById(screenshotId);
      if (!pgRow) {
        sendJson(res, origin, 404, { success: false, error: "Screenshot not found" });
        return true;
      }
      const ownerId = String(pgRow.member_id ?? "");
      const scope = await resolveActivityFeedScope(db, member.memberId, { memberId: ownerId });
      if (scope.forbidden) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to manage this screenshot" });
        return true;
      }

      let targetIds = [String(pgRow.id ?? screenshotId)];
      let runStart = toIso(pgRow.captured_at);
      let runEnd = runStart;
      if (applyToRun && pgRow.session_id) {
        // Threshold comes from the server setting, not a constant - an org
        // that raised the capture interval would otherwise see every capture
        // treated as its own run.
        const settings = await getActivityScoringSettings().catch(() => null);
        const sessionShots = await fetchPgSessionScreenshots(pgRow.session_id);
        const run = runContaining(sessionShots, pgRow.id ?? screenshotId, settings?.screenshotMaxDelaySec);
        if (run.length > 0) {
          targetIds = run.map((s) => String(s.id));
          runStart = toIso(run[0].captured_at);
          runEnd = toIso(run[run.length - 1].captured_at);
        }
      }

      const updated = await updatePgScreenshotActivityLevels(targetIds, {
        activityLevel,
        editedBy: member.memberId,
        reason,
      });
      sendJson(res, origin, 200, {
        success: true,
        data: { updated, ids: targetIds, activityLevel, runStart, runEnd },
      });
    } catch (e) {
      logSafeError("[activity/screenshot activity PATCH]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Activity level update failed",
      });
    }
    return true;
  }

  if (pn.startsWith("/api/activity/screenshot/") && req.method === "DELETE") {
    const idToken = readIdToken(req, url);
    const screenshotId = pn.slice("/api/activity/screenshot/".length).split("/")[0];
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    if (!screenshotId) {
      sendJson(res, origin, 400, { success: false, error: "Screenshot id is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      if (!isManagementRole(getAuthContext(req)?.roleName ?? "")) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions to delete screenshots." });
        return true;
      }

      const pgRow = await fetchPgScreenshotById(screenshotId);
      if (!pgRow) {
        sendJson(res, origin, 404, { success: false, error: "Screenshot not found" });
        return true;
      }
      const ownerId = String(pgRow.member_id ?? "");
      const scope = await resolveActivityFeedScope(db, member.memberId, { memberId: ownerId });
      if (scope.forbidden) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to manage this screenshot" });
        return true;
      }

      await pgQuery("DELETE FROM activity_screenshots WHERE id = $1", [String(pgRow.id ?? screenshotId)]);
      sendJson(res, origin, 200, { success: true, data: { id: String(pgRow.id ?? screenshotId) } });
    } catch (e) {
      logSafeError("[activity/screenshot DELETE]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Screenshot delete failed",
      });
    }
    return true;
  }

  if (pn === "/api/activity/feed" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    const feedType = (url.searchParams.get("type") || "screenshots").toLowerCase();
    const memberIdFilter = url.searchParams.get("memberId") || "";
    const projectScopeOnly = url.searchParams.get("projectScopeOnly") === "true";
    const dayParam = String(url.searchParams.get("day") || "").trim();
    const dayFilter = dayParam === "all" ? "" : dayParam;
    const sortMode = (url.searchParams.get("sort") || "newest").toLowerCase();
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }

      const scope = await resolveActivityFeedScope(db, member.memberId, {
        memberId: memberIdFilter,
        projectScopeOnly,
      });
      if (scope.forbidden) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to view this member's activity" });
        return true;
      }

      const memberMeta = await buildMemberMetaMap(
        db,
        scope.allowedMemberIds === null
          ? null
          : scope.allowedMemberIds.length <= 40
            ? scope.allowedMemberIds
            : scope.targetMemberIds ?? [],
      );
      const memberOptions = memberOptionsFromMeta(scope.allowedMemberIds, memberMeta, member.memberId);
      const { lookup: categoryLookup, updatedAt: classificationsUpdatedAt } = await buildCategoryLookup();
      const scopeMeta = {
        members: memberOptions,
        classificationsUpdatedAt,
        scope: {
          roleName: scope.roleName,
          canFilterByProject: scope.canFilterByProject,
          projectScopeOnly: scope.projectScopeOnly,
        },
      };

      if (feedType === "screenshots") {
        const captureEnabled = isActivityScreenshotsEnabled();
        const disabledReason = captureEnabled
          ? null
          : getActivityCaptureMode() === "agent"
            ? isDesktopAgentEventIngestEnabled()
              ? "New captures require the task timer to be running. Start a task timer to resume desktop capture."
              : "New screenshot capture is disabled on the server (ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED). Existing screenshots below are still available."
            : "Screenshot capture is only for task tracking (not enabled). Activity levels come from presence (mouse/keyboard) in the app.";

        const screenshotLimit = dayFilter ? 80 : 500;

        const pgRows = await fetchPgScreenshots(scope.targetMemberIds, dayFilter, screenshotLimit);
        // A screenshot taken while a browser was focused is categorised by the
        // site that was open, not by the browser. Only fetch the URL logs
        // needed to do that when a browser actually appears in the results.
        const screenshotUrlIndex = pgRows.some((r) => isBrowserAppName(r.app_name || ""))
          ? buildUrlIndex(await fetchPgUrlLogs(scope.targetMemberIds, dayFilter, URL_INDEX_LIMIT))
          : new Map();
        const rowMemberIds = [...new Set(pgRows.map((r) => String(r.member_id)).filter(Boolean))];
        const rowMemberMeta =
          rowMemberIds.length > 0 ? await buildMemberMetaMap(db, rowMemberIds) : new Map();
        const rows = pgRows.map((d) => {
          const memberId = String(d.member_id ?? "");
          const meta = rowMemberMeta.get(memberId) || { name: "Unknown", initials: "??" };
          const captured = toIso(d.captured_at);
          const date = captured ? new Date(captured) : new Date();
          const taskTitle = (typeof d.task_title === "string" && d.task_title.trim()) || "";
          const projectName = (typeof d.project_name === "string" && d.project_name.trim()) || "";
          const contextLabel = taskTitle ? "Task" : projectName ? "Project" : "Task";
          const contextValue = taskTitle || projectName || "No task linked";
          const resolved = resolveActivityCategory(categoryLookup, {
            appName: d.app_name || "",
            pageTitle: d.page_title || "",
            at: d.captured_at,
            sessionId: d.session_id,
            urlIndex: screenshotUrlIndex,
            domain: d.domain || "",
          });
          return {
            id: String(d.id),
            memberId,
            member: meta.name,
            avatar: meta.initials,
            avatarUrl: meta.avatarUrl ?? null,
            project: contextValue,
            projectName,
            contextLabel,
            taskTitle,
            capturedAt: captured || date.toISOString(),
            timestamp: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            time: date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            activityLevel: d.activity_level ?? 75,
            activeApp: d.app_name || "Browser",
            category: resolved.category,
            // Lets the UI explain *why* a browser capture is categorised the
            // way it is, instead of a badge that looks arbitrary.
            matchedDomain: resolved.domain || null,
            categorySource: resolved.source,
            hasImage: true,
            pageTitle: d.page_title || "",
          };
        });
        sendJson(res, origin, 200, {
          success: true,
          data: rows,
          ...scopeMeta,
          screenshotsEnabled: captureEnabled,
          ...(disabledReason ? { disabledReason } : {}),
        });
        return true;
      }

      if (feedType === "apps") {
        const byApp = new Map();
        const byMember = new Map();

        const ingestAppRow = (d, memberIdKey, urlIndex) => {
          const appName = normalizeAppName(d.app_name || d.appName || "Unknown");
          if (!appName) return;
          const dur = typeof d.duration_seconds === "number" ? d.duration_seconds : Number(d.durationSeconds ?? 0);
          const meta = memberMeta.get(memberIdKey) || { name: "Unknown", initials: "??" };
          const startedIso = toIso(d.started_at ?? d.startedAt);
          // Resolved per log row, not per app: one row is ~15s on one page, so
          // a browser's time is attributed to whichever site was open at that
          // moment rather than lumped under the browser's own category.
          const resolved = resolveActivityCategory(categoryLookup, {
            appName,
            pageTitle: d.page_title || d.pageTitle || "",
            at: d.started_at ?? d.startedAt,
            sessionId: d.session_id ?? d.sessionId,
            urlIndex,
          });
          const appRow = byApp.get(appName) || {
            name: appName,
            totalSeconds: 0,
            sessions: 0,
            lastActivityAt: "",
            categorySeconds: { productive: 0, neutral: 0, distracting: 0, unclassified: 0 },
            viaUrl: false,
          };
          appRow.totalSeconds += dur;
          appRow.sessions += 1;
          appRow.categorySeconds[resolved.category] =
            (appRow.categorySeconds[resolved.category] ?? 0) + dur;
          if (resolved.source !== "app") appRow.viaUrl = true;
          if (startedIso && startedIso > (appRow.lastActivityAt || "")) appRow.lastActivityAt = startedIso;
          byApp.set(appName, appRow);
          const memRow = byMember.get(memberIdKey) || {
            member: meta.name,
            avatar: meta.initials,
            avatarUrl: meta.avatarUrl ?? null,
            totalSeconds: 0,
            apps: new Map(),
            categorySeconds: { productive: 0, neutral: 0, distracting: 0, unclassified: 0 },
          };
          memRow.totalSeconds += dur;
          memRow.categorySeconds[resolved.category] =
            (memRow.categorySeconds[resolved.category] ?? 0) + dur;
          const appDur = memRow.apps.get(appName) || 0;
          memRow.apps.set(appName, appDur + dur);
          byMember.set(memberIdKey, memRow);
        };

        const pgRows = await fetchPgAppLogs(scope.targetMemberIds, dayFilter, 500);
        const appsUrlIndex = pgRows.some((r) => isBrowserAppName(r.app_name || ""))
          ? buildUrlIndex(await fetchPgUrlLogs(scope.targetMemberIds, dayFilter, URL_INDEX_LIMIT))
          : new Map();
        for (const d of pgRows) {
          ingestAppRow(d, String(d.member_id ?? ""), appsUrlIndex);
        }

        const formatDur = (sec) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };

        const totalAll = [...byApp.values()].reduce((s, r) => s + r.totalSeconds, 0) || 1;
        const appIcons = await getAppIconsByNamesPg([...byApp.values()].map((r) => r.name)).catch(
          () => new Map(),
        );
        const apps = [...byApp.values()]
          .sort((a, b) =>
            sortMode === "duration"
              ? b.totalSeconds - a.totalSeconds
              : Date.parse(b.lastActivityAt || 0) - Date.parse(a.lastActivityAt || 0),
          )
          .map((r, i) => ({
            id: String(i + 1),
            name: r.name,
            // A browser row spans many sites with different categories, so the
            // badge shows whichever category holds the most of its seconds.
            // Non-browser rows only ever have one, so this is a no-op there.
            category: dominantCategory(r.categorySeconds),
            viaUrl: r.viaUrl === true,
            totalTime: formatDur(r.totalSeconds),
            percentage: Math.round((r.totalSeconds / totalAll) * 100),
            trend: "neutral",
            trendValue: `${Math.round((r.totalSeconds / totalAll) * 100)}%`,
            sessions: r.sessions,
            lastActivityAt: r.lastActivityAt || null,
            iconDataUrl: appIcons.get(String(r.name).toLowerCase()) ?? null,
          }));

        const memberRows = [...byMember.entries()].map(([id, r]) => {
          let topApp = "—";
          let topDur = 0;
          for (const [app, dur] of r.apps.entries()) {
            if (dur > topDur) {
              topDur = dur;
              topApp = app;
            }
          }
          const byCategory = r.categorySeconds ?? { productive: 0, neutral: 0, distracting: 0, unclassified: 0 };
          const neutralSeconds = byCategory.neutral + byCategory.unclassified;
          const totalSeconds = r.totalSeconds || 1;
          return {
            memberId: id,
            member: r.member,
            avatar: r.avatar,
            avatarUrl: r.avatarUrl ?? null,
            productiveTime: formatDur(byCategory.productive),
            productivePercent: Math.round((byCategory.productive / totalSeconds) * 100),
            neutralTime: formatDur(neutralSeconds),
            unproductiveTime: formatDur(byCategory.distracting),
            topApp,
          };
        });

        sendJson(res, origin, 200, { success: true, data: { apps, members: memberRows }, ...scopeMeta });
        return true;
      }

      if (feedType === "urls") {
        const byUrl = new Map();
        const byMember = new Map();

        const touchMember = (memberIdKey, domain, dur, category) => {
          if (!memberIdKey) return;
          const meta = memberMeta.get(memberIdKey) || { name: "Unknown", initials: "??" };
          const memRow = byMember.get(memberIdKey) || {
            member: meta.name,
            avatar: meta.initials,
            avatarUrl: meta.avatarUrl ?? null,
            totalSeconds: 0,
            domains: new Map(),
            categorySeconds: { productive: 0, neutral: 0, distracting: 0, unclassified: 0 },
          };
          memRow.totalSeconds += dur;
          memRow.categorySeconds[category] = (memRow.categorySeconds[category] ?? 0) + dur;
          if (domain) memRow.domains.set(domain, (memRow.domains.get(domain) || 0) + dur);
          byMember.set(memberIdKey, memRow);
        };

        const ingestUrlRow = (d, timeField) => {
          const urlStr = typeof d.url === "string" ? d.url.trim() : "";
          const domain = typeof d.domain === "string" ? d.domain.trim() : "";
          const isFullUrl = /^https?:\/\//i.test(urlStr);
          if (!urlStr && !domain) return;
          if (!isFullUrl && !domain) return;
          const key = isFullUrl ? urlStr : `domain:${domain}`;
          const dur = typeof d.duration_seconds === "number" ? d.duration_seconds : 0;
          const visitedAt = toIso(d[timeField] ?? d.visited_at ?? d.visitedAt);
          const row = byUrl.get(key) || {
            domain: domain || parseDomain(urlStr),
            url: isFullUrl ? urlStr : domain,
            totalSeconds: 0,
            visits: 0,
            lastVisit: visitedAt,
            sourceKind: "url",
          };
          row.totalSeconds += dur;
          row.visits += 1;
          if (visitedAt > (row.lastVisit || "")) row.lastVisit = visitedAt;
          byUrl.set(key, row);
          touchMember(String(d.member_id ?? ""), row.domain, dur, categoryLookup("domain", row.domain));
        };

        const ingestAppUrlRow = (d) => {
          const appName = normalizeAppName(d.app_name || d.appName || "");
          if (!appName || !isBrowserAppName(appName)) return;
          const pageTitle = typeof d.page_title === "string" ? d.page_title.trim() : String(d.pageTitle ?? "").trim();
          if (!pageTitle) return;
          const httpFromTitle = extractHttpUrl(pageTitle);
          const dur = typeof d.duration_seconds === "number" ? d.duration_seconds : 0;
          const startedIso = toIso(d.started_at ?? d.startedAt);
          if (httpFromTitle) {
            const key = httpFromTitle;
            const row = byUrl.get(key) || {
              domain: parseDomain(httpFromTitle),
              url: httpFromTitle,
              totalSeconds: 0,
              visits: 0,
              lastVisit: startedIso,
              sourceKind: "url",
            };
            row.totalSeconds += dur;
            row.visits += 1;
            if (startedIso > (row.lastVisit || "")) row.lastVisit = startedIso;
            byUrl.set(key, row);
            touchMember(String(d.member_id ?? ""), row.domain, dur, categoryLookup("domain", row.domain));
            return;
          }
          const cleanTitle = titleFromBrowserPageTitle(pageTitle, appName);
          if (!cleanTitle) return;
          const siteName = siteNameFromWindowTitle(cleanTitle);
          const isWindow = !siteName;
          const key = siteName ? `site:${siteName.toLowerCase()}` : `window:${appName}:${cleanTitle}`;
          const row = byUrl.get(key) || {
            domain: siteName || appName,
            url: cleanTitle,
            totalSeconds: 0,
            visits: 0,
            lastVisit: startedIso,
            sourceKind: isWindow ? "window" : "url",
            // Window-title rows are classified by the cleaned title itself, not
            // by a domain - the "domain" shown is only the browser name.
            classifyMatch: isWindow ? "window_title" : "domain",
            classifyPattern: isWindow ? cleanTitle : siteName,
          };
          row.totalSeconds += dur;
          row.visits += 1;
          if (startedIso > (row.lastVisit || "")) row.lastVisit = startedIso;
          byUrl.set(key, row);
          touchMember(
            String(d.member_id ?? ""),
            row.domain,
            dur,
            categoryLookup(row.classifyMatch, row.classifyPattern),
          );
        };

        const urlRows = await fetchPgUrlLogs(scope.targetMemberIds, dayFilter, 500);
        const appRows = await fetchPgAppLogs(scope.targetMemberIds, dayFilter, 500);
        for (const d of urlRows) ingestUrlRow(d, "visited_at");
        for (const d of appRows) ingestAppUrlRow(d);

        const formatDur = (sec) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = sec % 60;
          if (h > 0) return `${h}h ${m}m`;
          if (m > 0) return `${m}m ${s}s`;
          return `${s}s`;
        };

        const urls = [...byUrl.values()]
          .sort((a, b) =>
            sortMode === "duration"
              ? b.totalSeconds - a.totalSeconds
              : Date.parse(b.lastVisit || 0) - Date.parse(a.lastVisit || 0),
          )
          .map((r, i) => ({
            id: String(i + 1),
            domain: r.domain,
            url: r.url,
            category: categoryLookup(r.classifyMatch ?? "domain", r.classifyPattern ?? r.domain),
            totalTime: formatDur(r.totalSeconds),
            visits: r.visits,
            avgTime: formatDur(Math.round(r.totalSeconds / Math.max(1, r.visits))),
            lastVisit: r.lastVisit ? new Date(r.lastVisit).toLocaleString() : "",
            sourceKind: r.sourceKind === "window" ? "window" : "url",
          }));

        const members = [...byMember.entries()].map(([id, r]) => {
          let topDomain = "—";
          let topDur = 0;
          for (const [domain, dur] of r.domains.entries()) {
            if (dur > topDur) {
              topDur = dur;
              topDomain = domain;
            }
          }
          const byCategory = r.categorySeconds;
          const neutralSeconds = byCategory.neutral + byCategory.unclassified;
          const totalSeconds = r.totalSeconds || 1;
          return {
            memberId: id,
            member: r.member,
            avatar: r.avatar,
            avatarUrl: r.avatarUrl ?? null,
            productiveTime: formatDur(byCategory.productive),
            productivePercent: Math.round((byCategory.productive / totalSeconds) * 100),
            neutralTime: formatDur(neutralSeconds),
            unproductiveTime: formatDur(byCategory.distracting),
            topDomain,
          };
        });

        sendJson(res, origin, 200, { success: true, data: { urls, members }, ...scopeMeta });
        return true;
      }

      sendJson(res, origin, 400, { success: false, error: "type must be screenshots, apps, or urls" });
    } catch (e) {
      logSafeError("[activity/feed]", e);
      sendJson(res, origin, 500, { success: false, error: e instanceof Error ? e.message : "Feed failed" });
    }
    return true;
  }

  if (pn === "/api/activity/agent/status" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const row = (await getMemberByIdPg(member.memberId)) || {};
      sendJson(res, origin, 200, {
        success: true,
        data: {
          captureMode: getActivityCaptureMode(),
          agentIngestEnabled: isDesktopAgentEventIngestEnabled(),
          webCaptureEnabled: isWebActivityCaptureEnabled(),
          linkedAt: toIso(row.desktop_agent_linked_at),
          agentSource: typeof row.agent_source === "string" ? row.agent_source : null,
          authPort: getEnv().activity.vtAuthPort,
          ...(await describeAgentPresence(member.memberId)),
        },
      });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  if (pn === "/api/activity/agent/link/init" && req.method === "POST") {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const session = await createAgentLinkSession({
      agentSource: body?.source === "python" ? "python" : "electron",
    });
    sendJson(res, origin, 200, { success: true, data: session });
    return true;
  }

  if (pn === "/api/activity/agent/link/complete" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    const linkToken = typeof body?.linkToken === "string" ? body.linkToken.trim() : "";
    if (!linkToken) {
      sendJson(res, origin, 400, { success: false, error: "linkToken is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken : "";
      const completed = await completeAgentLinkSession(linkToken, {
        memberId: member.memberId,
        idToken,
        refreshToken,
      });
      if (!completed.ok) {
        sendJson(res, origin, 400, { success: false, error: completed.error });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: { memberId: member.memberId } });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  if (pn === "/api/activity/agent/link/exchange" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const linkToken = typeof body?.linkToken === "string" ? body.linkToken.trim() : "";
    const agentSecret = typeof body?.agentSecret === "string" ? body.agentSecret.trim() : "";
    if (!linkToken || !agentSecret) {
      sendJson(res, origin, 400, { success: false, error: "linkToken and agentSecret are required" });
      return true;
    }
    const exchanged = await exchangeAgentLinkSession(linkToken, agentSecret);
    if (!exchanged.ok) {
      const code = exchanged.error === "Link session is not ready" ? 409 : 400;
      sendJson(res, origin, code, { success: false, error: exchanged.error });
      return true;
    }
    const memberId = typeof exchanged.data?.memberId === "string" ? exchanged.data.memberId : "";
    if (memberId) {
      await updateMemberPg(memberId, {
        desktop_agent_linked_at: new Date(),
        agent_source: exchanged.data?.agentSource === "python" ? "python" : "electron",
        updated_by: exchanged.data?.agentSource === "python" ? "python" : "agent",
      });
    }
    sendJson(res, origin, 200, { success: true, data: exchanged.data });
    return true;
  }

  if (pn === "/api/activity/agent/device/register" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      const deviceId = newDeviceId();
      const agentSecret = crypto.randomBytes(32).toString("base64url");
      const device = await registerAgentDevice({
        memberId: member.memberId,
        deviceId,
        agentSecret,
        agentSource: "tauri",
        vmDetected: typeof body.vmDetected === "boolean" ? body.vmDetected : undefined,
        vmSignals: Array.isArray(body.vmSignals) ? body.vmSignals.filter((s) => typeof s === "string") : undefined,
      });
      if (!device) {
        sendJson(res, origin, 500, { success: false, error: "Could not register this device." });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: { deviceId, agentSecret } });
    } catch (e) {
      logSafeError("[activity/agent/device/register]", e);
      sendJson(res, origin, 500, { success: false, error: "Could not register this device." });
    }
    return true;
  }

  if (pn === "/api/activity/agent/reauth" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    const agentSecret = typeof body?.agentSecret === "string" ? body.agentSecret.trim() : "";
    if (!deviceId || !agentSecret) {
      sendJson(res, origin, 400, { success: false, error: "deviceId and agentSecret are required" });
      return true;
    }

    const auth = getAuthAdmin();
    if (!auth) {
      sendJson(res, origin, 503, { success: false, error: "Authentication service is not configured." });
      return true;
    }

    try {
      const verified = await verifyAgentDevice(deviceId, agentSecret);
      if (!verified.ok) {
        sendJson(res, origin, 401, { success: false, error: "This device is no longer linked." });
        return true;
      }

      const memberRow = await getMemberByIdPg(verified.memberId);
      if (!memberRow) {
        await revokeAgentDevice(deviceId);
        sendJson(res, origin, 401, { success: false, error: "This device is no longer linked." });
        return true;
      }

      const status = String(memberRow.status || "active").toLowerCase();
      if (status === "archived" || status === "inactive" || status === "suspended") {
        await revokeAgentDevicesForMember(verified.memberId);
        sendJson(res, origin, 403, { success: false, error: "This account is no longer active." });
        return true;
      }

      const firebaseUid = String(memberRow.firebase_uid || memberRow.firebaseUid || "").trim();
      const email = String(memberRow.work_email || memberRow.email || "").trim().toLowerCase();

      const banCheck = await assertMemberNotBanned(db, {
        email,
        memberId: verified.memberId,
        firebaseUid,
      });
      if (!banCheck.ok) {
        await revokeAgentDevicesForMember(verified.memberId);
        sendJson(res, origin, banCheck.status ?? 403, { success: false, error: banCheck.error });
        return true;
      }

      if (!firebaseUid) {
        sendJson(res, origin, 409, {
          success: false,
          error: "This account has no sign-in identity. Re-link the agent.",
        });
        return true;
      }

      const customToken = await auth.createCustomToken(firebaseUid);
      sendJson(res, origin, 200, {
        success: true,
        data: { customToken, memberId: verified.memberId },
      });
    } catch (e) {
      logSafeError("[activity/agent/reauth]", e);
      sendJson(res, origin, 500, { success: false, error: "Could not re-authenticate this device." });
    }
    return true;
  }

  if (pn === "/api/activity/agent/register" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const member = await resolveMember(db, req);
      if (!member) {
        sendJson(res, origin, 404, { success: false, error: "Member not found" });
        return true;
      }
      await updateMemberPg(member.memberId, {
        ...(body?.source === "web"
          ? { web_capture_linked_at: new Date(), updated_by: "web" }
          : {
              desktop_agent_linked_at: new Date(),
              agent_source: body?.source === "python" ? "python" : "electron",
              updated_by: body?.source === "python" ? "python" : "agent",
            }),
      });
      sendJson(res, origin, 200, { success: true, data: { memberId: member.memberId } });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  if (pn === "/api/activity/scoring-settings" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      sendJson(res, origin, 200, { success: true, data: await getActivityScoringSettings() });
    } catch (e) {
      logSafeError("[activity/scoring-settings GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load scoring settings." });
    }
    return true;
  }

  if (pn === "/api/activity/scoring-settings" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const viewer = getAuthContext(req);
      const updated = await setActivityScoringSettings(
        {
          saturationEvents: body.saturationEvents,
          windowMs: body.windowMs,
          screenshotMinDelaySec: body.screenshotMinDelaySec,
          screenshotMaxDelaySec: body.screenshotMaxDelaySec,
          idleThresholdSec: body.idleThresholdSec,
          idleWarnSec: body.idleWarnSec,
          idleAlertSec: body.idleAlertSec,
          idleStopSec: body.idleStopSec,
        },
        { memberId: viewer?.memberId, roleName: viewer?.roleName ?? "" },
      );
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = e && e.code === "FORBIDDEN" ? 403 : e && String(e.code || "").startsWith("INVALID_") ? 400 : 500;
      if (status === 500) logSafeError("[activity/scoring-settings POST]", e);
      sendJson(res, origin, status, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update scoring settings.",
      });
    }
    return true;
  }

  if (pn.startsWith("/api/activity/integrity/session/") && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    const sessionId = pn.slice("/api/activity/integrity/session/".length).split("/")[0];
    if (!sessionId) {
      sendJson(res, origin, 400, { success: false, error: "Session id is required" });
      return true;
    }
    try {
      const viewer = getAuthContext(req);
      const sessionRow = await getPgSessionById(sessionId);
      if (!sessionRow) {
        sendJson(res, origin, 404, { success: false, error: "Session not found" });
        return true;
      }
      const scope = await resolveActivityFeedScope(db, viewer.memberId, { memberId: String(sessionRow.member_id ?? "") });
      if (scope.forbidden) {
        sendJson(res, origin, 403, { success: false, error: "Not allowed to view this session's integrity summary" });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data: await getSessionIntegritySummary(sessionId) });
    } catch (e) {
      logSafeError("[activity/integrity/session GET]", e);
      sendJson(res, origin, 500, { success: false, error: "Failed to load integrity summary." });
    }
    return true;
  }

  if (pn === "/api/activity/integrity/flags" && req.method === "GET") {
    const idToken = readIdToken(req, url);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    try {
      const viewer = getAuthContext(req);
      const targetMemberId = url.searchParams.get("memberId") || viewer.memberId;
      const flags = await getMemberIntegrityFlags(targetMemberId, {
        memberId: viewer.memberId,
        roleName: viewer.roleName ?? "",
      });
      sendJson(res, origin, 200, { success: true, data: flags });
    } catch (e) {
      const status = e && e.code === "FORBIDDEN" ? 403 : 500;
      if (status === 500) logSafeError("[activity/integrity/flags GET]", e);
      sendJson(res, origin, status, { success: false, error: e instanceof Error ? e.message : "Failed to load flags." });
    }
    return true;
  }

  if (pn.startsWith("/api/activity/integrity/flags/") && pn.endsWith("/contest") && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const idToken = readIdToken(req, url, body);
    if (!idToken) {
      sendJson(res, origin, 401, { success: false, error: "Authorization Bearer token is required" });
      return true;
    }
    const flagId = pn.slice("/api/activity/integrity/flags/".length).replace(/\/contest$/, "");
    try {
      const viewer = getAuthContext(req);
      const updated = await contestIntegrityFlag(flagId, body.note, {
        memberId: viewer.memberId,
        roleName: viewer.roleName ?? "",
      });
      sendJson(res, origin, 200, { success: true, data: updated });
    } catch (e) {
      const status = e && e.code === "FORBIDDEN" ? 403 : e && e.code === "NOT_FOUND" ? 404 : 500;
      if (status === 500) logSafeError("[activity/integrity/flags contest POST]", e);
      sendJson(res, origin, status, { success: false, error: e instanceof Error ? e.message : "Failed to contest flag." });
    }
    return true;
  }

  return false;
}
