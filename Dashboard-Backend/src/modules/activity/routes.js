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
import { isProjectMemberForTimer } from "../../http/project-access.js";
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
  fetchPgUrlLogs,
  findOpenPgSession,
  getPgSessionById,
  insertActivityAppLog,
  insertActivityScreenshot,
  insertActivityUrlLog,
  sumMemberActiveIdleSeconds,
  updatePgSession,
} from "../../lib/postgres/activity-events-postgres.service.js";
import { closeAbandonedSession, isAgentOnline, isSessionAbandoned, touchAgentHeartbeat } from "./agent-heartbeat.js";

/** Monday=0..Sunday=6, matching time_settings.work_days/makeup_days storage. */
function todayWeekdayIndex() {
  return (new Date().getDay() + 6) % 7;
}

/**
 * Working days gate (People > member > Work Time & Limits): a member can
 * only start/resume tracking on a selected work_days weekday, or a
 * double-clicked makeup_days weekday. Shift-scheduled members skip this -
 * their availability comes from shifts, not this weekday toggle.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
async function getMemberTodayWorkStatus(db, memberId) {
  if (await memberUsesShiftsForLimits(db, memberId)) {
    return { workingToday: true, isMakeupDay: false };
  }
  const timeSettings = await getSingleByMemberId(db, "time_settings", memberId);
  const workDays = Array.isArray(timeSettings?.work_days) ? timeSettings.work_days : [0, 1, 2, 3, 4];
  const makeupDays = Array.isArray(timeSettings?.makeup_days) ? timeSettings.makeup_days : [];
  const today = todayWeekdayIndex();
  const isMakeupDay = makeupDays.includes(today);
  return { workingToday: isMakeupDay || workDays.includes(today), isMakeupDay };
}

/**
 * Project budget usage vs its stop-timer threshold - shared by the
 * start/resume hard gate (blocks the request) and the sync tick (reports
 * budgetCapped so the client can stop an already-running session, the same
 * TC-5 shape task daily caps use). Returns null when there's nothing to
 * enforce (no budget row, or stop-on-reach isn't configured).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} projectId
 */
async function checkProjectBudgetCap(db, projectId) {
  const budget = await getProjectBudgetPg(projectId);
  if (!budget) return null;
  const spent = await computeProjectSpentPg(db, projectId, budget);
  // scope='per_person' rows store hours-per-member in `cost`, not the real
  // cap - computeProjectBudgetTargetPg is the live total (cost x headcount,
  // x rate for Cost based). Using raw `cost` here would cap at the
  // per-person figure instead of the real team-wide budget.
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

/**
 * ACT-4: pulls the raw ActivityMeter counters off a screenshot/app event, if
 * the agent sent them (flattened onto the same object by serde on the Rust
 * side - see ActivitySignal in types.rs). A web-sourced event, or an agent
 * older than ACT-4, carries none of this; the Postgres layer defaults every
 * field to 0 in that case, so passing it through unconditionally is safe.
 */
function readActivitySignal(ev) {
  return {
    keystrokeCount: ev.keystrokeCount,
    distinctKeyCount: ev.distinctKeyCount,
    mouseDistancePx: ev.mouseDistancePx,
    injectedEventCount: ev.injectedEventCount,
    activeSecondsInWindow: ev.activeSecondsInWindow,
  };
}

/**
 * app/domain -> configured category, for the Apps and URLs feeds. Returns
 * "unclassified" for anything with no row, which is what the classify dialog
 * lists as still needing a decision - never "neutral", which is a deliberate
 * choice someone made.
 * @returns {Promise<(matchType: "app" | "domain", pattern: string) => string>}
 */
async function buildCategoryLookup() {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  try {
    for (const row of await getAllCategories()) {
      const pattern = typeof row.pattern === "string" ? row.pattern.trim().toLowerCase() : "";
      if (!pattern) continue;
      byKey.set(`${row.matchType}:${pattern}`, row.category || "unclassified");
    }
  } catch (err) {
    // A classification read failing must not take the whole feed down with
    // it - the feed's own numbers are still correct without labels.
    logSafeWarn("[activity/feed] classification lookup failed", err);
  }
  return (matchType, pattern) => {
    const key = typeof pattern === "string" ? pattern.trim().toLowerCase() : "";
    if (!key) return "unclassified";
    return byKey.get(`${matchType}:${key}`) ?? "unclassified";
  };
}

function parseDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractHttpUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function titleFromBrowserPageTitle(pageTitle, appName) {
  const raw = String(pageTitle || "").trim();
  if (!raw) return "";
  const suffixes = [
    ` - ${appName}`,
    ` — ${appName}`,
    ` | ${appName}`,
    " - Google Chrome",
    " - Microsoft Edge",
    " - Mozilla Firefox",
  ];
  let title = raw;
  for (const suffix of suffixes) {
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
  }
  return title;
}

const MANAGER_TRACKING_DISABLED_MESSAGE =
  "Time tracking on this project has been turned off for managers. Contact an admin or owner.";

/** True only for the "Manager" role (not Super Manager/Admin/Owner). */
function isManagerRoleName(roleName) {
  return String(roleName || "").trim().toLowerCase().replace(/\s+/g, "") === "manager";
}

/**
 * Authenticated member from req context (auth middleware).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("node:http").IncomingMessage} req
 */
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

/**
 * A desktop-agent session left open by a crash/kill (no clean stop) never gets
 * closed on its own - the agent isn't there anymore to call "stop". Every
 * caller of findOpenSession routes through here, so on the first request
 * after the agent's heartbeat (15s TTL) has lapsed, close it server-side
 * instead of leaving it "active" forever with stale hours. The background
 * sweep (abandoned-session-sweep.service.js) covers the case where nobody
 * hits this endpoint again for that member at all.
 */
async function findOpenSession(memberId) {
  const open = await findOpenPgSession(memberId);
  if (!open) return null;
  if (await isSessionAbandoned(open)) {
    await closeAbandonedSession(open);
    return null;
  }
  return open;
}

/**
 * TC-7: true if `err` is a violation of the activity_sessions_one_open_per_member
 * partial unique index (ensure-lookup-schema.js). findOpenSession() above is
 * only a pre-check - two "start"/"resume" requests that both see no open
 * session and both reach createPgSession race on this index, and the loser
 * gets this. Postgres error 23505 = unique_violation; the constraint name is
 * checked too so an unrelated 23505 (extremely unlikely id collision on
 * gen_random_uuid, but not this index) doesn't get mis-attributed.
 * @param {unknown} err
 */
export function isOneOpenSessionConflict(err) {
  return (
    err instanceof Object &&
    /** @type {{ code?: string, constraint?: string }} */ (err).code === "23505" &&
    /** @type {{ code?: string, constraint?: string }} */ (err).constraint ===
      "activity_sessions_one_open_per_member"
  );
}

/**
 * ID-3: task-anchored sessions get the owning project's idle-time settings
 * from `fetch_task_time_tracking` on every task transition (see
 * task-time-tracking.js) - cheap because it's throttled to transitions, not
 * every 5s poll. A calling (task-less) project session has no task
 * transition to hang that fetch off of, so it's attached here instead, on
 * this same GET the agent already polls every SESSION_POLL_SEC. Scoped to
 * task-less sessions only so a task-anchored session's 5s poll doesn't pay
 * for a project lookup it doesn't need.
 */
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
    screenshotsEnabled: isActivityScreenshotsEnabled(),
    ...(disableIdleTime !== undefined ? { disableIdleTime, idleTimeSeconds } : {}),
  };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
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
      // The desktop agent polls this same endpoint every 5s without a browser Origin
      // header — piggyback its own liveness on that instead of a separate heartbeat call.
      if (!origin) void touchAgentHeartbeat(member.memberId);
      const open = await findOpenSession(member.memberId);
      sendJson(res, origin, 200, {
        success: true,
        data: open ? await normalizeSession(open.id, open) : null,
      });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  // The viewer's own daily/weekly work-hour limits - previously only ever read
  // internally by enforcement (timer-limit.service.js); this is the first
  // self-serve read of them, for a profile view to show "how many hours am I
  // allowed" without duplicating the People > member > Limits configuration.
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
      // timerAllowance is the same computation the calling-project start path
      // gates on below, so what the agent displays as "remaining today" and
      // what actually blocks the start button can never disagree.
      const { todayDay } = currentDayRange();
      const [
        dailyHours,
        weeklyHours,
        usesShifts,
        timerAllowance,
        assignedDemand,
        todayWorkStatus,
        todayActivity,
      ] = await Promise.all([
        getMemberLimitHours(db, member.memberId, "daily"),
        getMemberLimitHours(db, member.memberId, "weekly"),
        memberUsesShiftsForLimits(db, member.memberId),
        computeMemberTimerAllowance(db, member.memberId),
        computeAssignedTodayDemand(member.memberId),
        getMemberTodayWorkStatus(db, member.memberId),
        sumMemberActiveIdleSeconds(member.memberId, { fromDay: todayDay, toDay: todayDay }),
      ]);
      // Shift-based members have no daily/weekly cap (loadMemberCapContext
      // zeroes it out), so nothing caps their assigned demand either -
      // T5's "report demandSeconds, plannedSeconds = demandSeconds" case.
      const capLeftToday = usesShifts ? null : timerAllowance.allowedRemainingSeconds;
      const assignedToday = applyCapToAssignedTodayDemand(assignedDemand, capLeftToday);
      sendJson(res, origin, 200, {
        success: true,
        data: {
          dailyHours,
          weeklyHours,
          usesShifts,
          timerAllowance,
          assignedToday,
          workingToday: todayWorkStatus.workingToday,
          isMakeupDay: todayWorkStatus.isMakeupDay,
          // Both halves from activity_sessions, so the agent's activity meter
          // matches the percentage the dashboard reports for the same day.
          todayActivity,
        },
      });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
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
    // Free-text, member-supplied - capped so a runaway client can't write an
    // unbounded blob into the row.
    const stopNote =
      typeof body.stopNote === "string" && body.stopNote.trim()
        ? body.stopNote.trim().slice(0, 1000)
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

      const now = new Date();
      let open = await findOpenSession(member.memberId);

      // Which project this session belongs to. Task-based sessions derive it
      // from the task; "calling" projects have no task, so the client sends it
      // and it is the only link between the session and the project it bills.
      let sessionProjectId = bodyProjectId || open?.project_id || null;

      // Daily/weekly/task-total caps were computed but never actually gated
      // starting a session here — enforceTimerAllowanceOnSync's rejection was
      // only thrown from the best-effort task-tracking sync below, by which
      // point the session was already created and marked active. Check first.
      if (action === "start" || action === "resume") {
        const effectiveTaskId = taskId || open?.task_id || null;
        const cumulativeActiveSeconds = Math.max(0, Math.floor(activeSeconds ?? 0));
        const viewer = getAuthContext(req);

        // People > member > Settings > "Able to track time" - a hard gate on
        // starting/resuming, checked before the task/project allowance below
        // so it can't be bypassed by any timer type.
        const timeSettings = await getSingleByMemberId(db, "time_settings", member.memberId);
        if (timeSettings?.able_to_track_time === false) {
          sendJson(res, origin, 403, {
            success: false,
            error: "Time tracking is disabled for this member.",
          });
          return true;
        }

        // People > member > Work Time & Limits > "Working days" - same gate,
        // reusing the timeSettings row already fetched above. Skipped for
        // shift-scheduled members (their availability comes from shifts).
        if (!(await memberUsesShiftsForLimits(db, member.memberId))) {
          const workDays = Array.isArray(timeSettings?.work_days) ? timeSettings.work_days : [0, 1, 2, 3, 4];
          const makeupDays = Array.isArray(timeSettings?.makeup_days) ? timeSettings.makeup_days : [];
          const today = todayWeekdayIndex();
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
          // Task-less timer. "calling" projects always work this way, and a
          // normal project can opt in via require_task_to_track = false -
          // only for their own members, so the project-membership check here
          // is the equivalent of the task-assignment check a normal timer
          // gets via canAccessTask below.
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
          // Strict `=== false`: an un-migrated row reads undefined here and
          // must fall back to requiring a task, not to allowing everything.
          const allowsTaskLessTimer =
            isTaskLessProjectType(project.type) || project.require_task_to_track === false;
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
          // No task estimate to enforce (that is the point of a calling
          // project) - the member's own daily/weekly hour cap still applies,
          // plus this project's own per-person budget if it has one.
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

        // Project budget gate (item 4 of the budget fixes plan) - applies to
        // both branches above alike, since sessionProjectId is resolved by
        // this point whether it came from the task or (calling projects)
        // straight from the request body. `stop_timers_when_reached` was
        // being persisted since the project was created but nothing ever
        // read it back to actually stop anything - this is that read.
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
            // Notify is best-effort and never blocks the timer - a failed
            // notification is not a reason to stop someone from working.
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
          // Only "stop" may lower active_seconds - this is the desktop
          // agent's idle-escalation rewind reversing time credited after the
          // user actually stopped touching the machine (TC-4).
          await updatePgSession(
            open.id,
            {
              status: "stopped",
              endedAt: now,
              updatedAt: now,
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

      const syncTaskId = taskId || open?.task_id || null;
      // TC-5: surfaced on the wire so a caller can act on the cap being hit
      // (e.g. stop the timer instead of quietly having its number truncated
      // while the clock keeps running). Additive - a client that ignores it
      // sees no behavior change.
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

      // Same TC-5 shape as timerCapped above, but for the project's own
      // budget stop-timer threshold (Budget & Limits tab) - that gate was
      // start/resume-only (see checkProjectBudgetCap's call site above), so
      // a session already running when the project crossed the threshold
      // never got stopped. Surfaced here so the sync tick can act on it too.
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

      // CF-0.3: fetched once per batch (up to 50 events), not once per event -
      // both are cheap, tiny tables, but there is no reason to round-trip
      // Postgres 50 times for config that cannot change mid-request.
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
          // CF-0.3: an excluded app produces no screenshot at all - not a
          // blurred one. Checked before any image processing, not after.
          if (matchesExclusion(exclusions, "app", appName)) continue;
          const imageData =
            typeof ev.imageData === "string"
              ? ev.imageData
              : typeof ev.image_data === "string"
                ? ev.image_data
                : "";
          if (!imageData) continue;
          // Leaves headroom under MAX_ACTIVITY_EVENTS_BODY_BYTES for the rest of the
          // JSON envelope (sessionId, appName, pageTitle, etc).
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
                  // CF-0.3 blur-by-default posture. Radius chosen to obscure
                  // legible text/detail, not merely soften the image.
                  pipeline = pipeline.blur(18);
                }
                const webp = await pipeline.webp({ quality: 75 }).toBuffer();
                const capturedAt = ev.captured_at ? new Date(ev.captured_at) : now;
                // AC-2: hashed from the pre-blur, original-resolution buffer, not the
                // stored (possibly CF-0.3-blurred) webp - blur would flatten every
                // capture toward the same hash and defeat the staleness comparison
                // this exists for. A hash failure (corrupt/unusual image data) must
                // not drop the screenshot itself, so it's caught independently.
                let perceptualHash = null;
                try {
                  perceptualHash = await computeDHash(buffer);
                } catch (hashErr) {
                  logSafeWarn("[activity events] perceptual hash failed", hashErr);
                }
                // Stored as bytea in Postgres (image_data) - no per-screenshot GCS upload or
                // Firestore write. The archive job moves rows out to GCS once they age out.
                await insertActivityScreenshot({
                  id,
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
                // Don't let one bad screenshot (corrupt base64, sharp/libvips failure)
                // fail the whole batch response — log it so it's actually diagnosable.
                logSafeWarn("[activity events] screenshot insert failed", err);
              }
            })(),
          );
          continue;
        }
        if (type === "app") {
          const appName = typeof ev.appName === "string" ? ev.appName.slice(0, 200) : "Unknown";
          // CF-0.3: same exclusion the screenshot path checks - an excluded
          // app is excluded from app/window logging too, not just screenshots.
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
          count++;
        } else if (type === "url") {
          const rawUrlStr = typeof ev.url === "string" ? ev.url.slice(0, 2000) : "";
          const domain = parseDomain(rawUrlStr);
          // CF-0.3: a domain on the exclusion list (banking, health, personal
          // email) is skipped entirely - no URL row, no partial capture.
          if (matchesExclusion(exclusions, "domain", domain)) continue;
          // CF-0.3 domain-only mode: store "github.com", not the full path +
          // query string, which can carry personal data (search terms,
          // account IDs, tokens). The domain column already existed for
          // reporting; this is what makes it the *only* thing stored too.
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

      // CF-0.5: "log every access" to raw screenshot data - only reached once
      // the authorization check above has already succeeded; this makes no
      // access decision of its own. Fire-and-forget so a logging hiccup
      // never blocks the read itself.
      void recordScreenshotAccess({
        screenshotId: resolvedId,
        screenshotOwner: ownerId,
        readerMemberId: member.memberId,
      }).catch((err) => logSafeWarn("[activity/screenshot access log]", err));

      // Bytea rows (the common case now) are served straight from Postgres as a data
      // URL, gated by the auth + ownership checks above instead of a signed link.
      // Older/archived rows only carry screenshot_url and still use the signed-URL path.
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

  // Backs the Delete action on the Screenshots page, which was a permission-
  // gated button with no endpoint behind it at all (canManageActivityData's
  // own comment said "when backed by API" - it wasn't).
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
      // Deleting monitoring evidence is a management action, not something a
      // member may do to their own captures - hence a role check on top of
      // the same visibility scope the read path uses.
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
      const scopeMeta = {
        members: memberOptions,
        scope: {
          roleName: scope.roleName,
          canFilterByProject: scope.canFilterByProject,
          projectScopeOnly: scope.projectScopeOnly,
        },
      };

      // Every feed reports the classification an admin actually configured in
      // activity_categories. One read per feed request, keyed the same way the
      // table's unique index is (match_type + lowered pattern).
      const categoryLookup = await buildCategoryLookup();

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
        const rowMemberIds = [...new Set(pgRows.map((r) => String(r.member_id)).filter(Boolean))];
        const rowMemberMeta =
          rowMemberIds.length > 0 ? await buildMemberMetaMap(db, rowMemberIds) : new Map();
        const rows = pgRows.map((d) => {
          const memberId = String(d.member_id ?? "");
          const meta = rowMemberMeta.get(memberId) || { name: "Unknown", initials: "??" };
          const captured = toIso(d.captured_at);
          const date = captured ? new Date(captured) : new Date();
          // A session tracking a project directly (no task) used to render as
          // "Task: No task linked". It has a project, so say which one -
          // contextLabel tells the client which of the two it is looking at.
          const taskTitle = (typeof d.task_title === "string" && d.task_title.trim()) || "";
          const projectName = (typeof d.project_name === "string" && d.project_name.trim()) || "";
          const contextLabel = taskTitle ? "Task" : projectName ? "Project" : "Task";
          const contextValue = taskTitle || projectName || "No task linked";
          return {
            id: String(d.id),
            memberId,
            member: meta.name,
            avatar: meta.initials,
            project: contextValue,
            projectName,
            contextLabel,
            taskTitle,
            capturedAt: captured || date.toISOString(),
            timestamp: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            time: date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            activityLevel: d.activity_level ?? 75,
            activeApp: d.app_name || "Browser",
            // Real configured classification, so the productivity roll-ups on
            // this page stop keying off a hardcoded list of app names.
            category: categoryLookup("app", d.app_name || ""),
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

        const ingestAppRow = (d, memberIdKey) => {
          const appName = normalizeAppName(d.app_name || d.appName || "Unknown");
          if (!appName) return;
          const dur = typeof d.duration_seconds === "number" ? d.duration_seconds : Number(d.durationSeconds ?? 0);
          const meta = memberMeta.get(memberIdKey) || { name: "Unknown", initials: "??" };
          const startedIso = toIso(d.started_at ?? d.startedAt);
          const appRow = byApp.get(appName) || { name: appName, totalSeconds: 0, sessions: 0, lastActivityAt: "" };
          appRow.totalSeconds += dur;
          appRow.sessions += 1;
          if (startedIso && startedIso > (appRow.lastActivityAt || "")) appRow.lastActivityAt = startedIso;
          byApp.set(appName, appRow);
          const memRow = byMember.get(memberIdKey) || {
            member: meta.name,
            avatar: meta.initials,
            totalSeconds: 0,
            apps: new Map(),
            categorySeconds: { productive: 0, neutral: 0, distracting: 0, unclassified: 0 },
          };
          memRow.totalSeconds += dur;
          const category = categoryLookup("app", appName);
          memRow.categorySeconds[category] = (memRow.categorySeconds[category] ?? 0) + dur;
          const appDur = memRow.apps.get(appName) || 0;
          memRow.apps.set(appName, appDur + dur);
          byMember.set(memberIdKey, memRow);
        };

        const pgRows = await fetchPgAppLogs(scope.targetMemberIds, dayFilter, 500);
        for (const d of pgRows) {
          ingestAppRow(d, String(d.member_id ?? ""));
        }

        const formatDur = (sec) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };

        const totalAll = [...byApp.values()].reduce((s, r) => s + r.totalSeconds, 0) || 1;
        const apps = [...byApp.values()]
          .sort((a, b) =>
            sortMode === "duration"
              ? b.totalSeconds - a.totalSeconds
              : Date.parse(b.lastActivityAt || 0) - Date.parse(a.lastActivityAt || 0),
          )
          .map((r, i) => ({
            id: String(i + 1),
            name: r.name,
            category: categoryLookup("app", r.name),
            totalTime: formatDur(r.totalSeconds),
            percentage: Math.round((r.totalSeconds / totalAll) * 100),
            trend: "neutral",
            trendValue: `${Math.round((r.totalSeconds / totalAll) * 100)}%`,
            sessions: r.sessions,
            lastActivityAt: r.lastActivityAt || null,
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
          // Was hardcoded to "100% productive, 0 neutral, 0 unproductive" for
          // everyone, which made the member table say the same thing no matter
          // what anyone actually ran. Split by the configured classification;
          // unclassified time counts as neutral here rather than inventing a
          // fourth column the UI has no room for.
          const byCategory = r.categorySeconds ?? { productive: 0, neutral: 0, distracting: 0, unclassified: 0 };
          const neutralSeconds = byCategory.neutral + byCategory.unclassified;
          const totalSeconds = r.totalSeconds || 1;
          return {
            memberId: id,
            member: r.member,
            avatar: r.avatar,
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

        const ingestUrlRow = (d, timeField) => {
          const urlStr = typeof d.url === "string" ? d.url.trim() : "";
          if (!urlStr || !/^https?:\/\//i.test(urlStr)) return;
          const key = urlStr;
          const dur = typeof d.duration_seconds === "number" ? d.duration_seconds : 0;
          const visitedAt = toIso(d[timeField] ?? d.visited_at ?? d.visitedAt);
          const row = byUrl.get(key) || {
            domain: d.domain || parseDomain(urlStr),
            url: urlStr,
            totalSeconds: 0,
            visits: 0,
            lastVisit: visitedAt,
            sourceKind: "url",
          };
          row.totalSeconds += dur;
          row.visits += 1;
          if (visitedAt > (row.lastVisit || "")) row.lastVisit = visitedAt;
          byUrl.set(key, row);
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
            return;
          }
          const cleanTitle = titleFromBrowserPageTitle(pageTitle, appName);
          if (!cleanTitle) return;
          const key = `window:${appName}:${cleanTitle}`;
          const row = byUrl.get(key) || {
            domain: appName,
            url: cleanTitle,
            totalSeconds: 0,
            visits: 0,
            lastVisit: startedIso,
            sourceKind: "window",
          };
          row.totalSeconds += dur;
          row.visits += 1;
          if (startedIso > (row.lastVisit || "")) row.lastVisit = startedIso;
          byUrl.set(key, row);
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
            category: categoryLookup("domain", r.domain),
            totalTime: formatDur(r.totalSeconds),
            visits: r.visits,
            avgTime: formatDur(Math.round(r.totalSeconds / Math.max(1, r.visits))),
            lastVisit: r.lastVisit ? new Date(r.lastVisit).toLocaleString() : "",
            sourceKind: r.sourceKind === "window" ? "window" : "url",
          }));

        sendJson(res, origin, 200, { success: true, data: urls, ...scopeMeta });
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
          agentOnline: await isAgentOnline(member.memberId),
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

  // Issues a device credential to an already-authenticated agent.
  //
  // The link/exchange response carries one on the happy path, but the browser
  // can also hand tokens straight to the agent over loopback, which skips the
  // exchange entirely - and agents linked before device credentials existed
  // have none at all. Both self-heal by calling this once they have a token.
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
      // Server-generated so the agent never picks its own secret.
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

  // Lets an already-linked machine mint fresh credentials from its own device
  // secret, so a dead refresh token is recoverable in-app instead of forcing
  // the user back through a browser link (agent-reconnect-plan.md §4.2a).
  //
  // Deliberately re-runs every gate a normal sign-in runs - ban, member
  // existence, account status. A device credential must never outlive the
  // access of the account it belongs to.
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
        // 401 (not 403): the agent should treat this as "re-link required".
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

      // A custom token is exchanged by the agent for a real id/refresh pair.
      // Minting it here is what keeps recovery inside the app.
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

  // ACT-3: scoring calibration the agent polls periodically. Read is open to
  // any authenticated caller (it's just tuning numbers, not sensitive);
  // write is management-only.
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

  // AC-4: "an employee can view ... their own flags" - defaults to the caller's
  // own, same self-or-management gate as getMemberIntegrityFlags enforces.
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
