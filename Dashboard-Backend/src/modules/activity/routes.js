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
import { getAuthAdmin, getDb } from "../../config/firebase.js";
import { getAuthContext } from "../../http/auth-context.js";
import { readIdToken } from "../../http/auth-token.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import {
  buildMemberMetaMap,
  memberOptionsFromMeta,
  resolveActivityFeedScope,
} from "./activity-scope.js";
import { maybeAlertLowActivity, maybeAlertMissingScreenshot } from "./activity-alerts.js";
import {
  completeAgentLinkSession,
  createAgentLinkSession,
  exchangeAgentLinkSession,
} from "./agent-link-sessions.js";
import { canAccessTask } from "../../http/task-access.js";
import { logSafeError, logSafeWarn } from "../../http/sanitize-error.js";
import { syncTaskTimeTracking } from "../tasks/task-time-tracking.js";
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
  updatePgSession,
} from "../../lib/postgres/activity-events-postgres.service.js";
import { isAgentOnline, touchAgentHeartbeat } from "./agent-heartbeat.js";

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

function parseDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const APP_EXE_DISPLAY_NAMES = {
  "chrome.exe": "Google Chrome",
  "msedge.exe": "Microsoft Edge",
  "firefox.exe": "Mozilla Firefox",
  "brave.exe": "Brave",
  "opera.exe": "Opera",
  "cursor.exe": "Cursor",
  "code.exe": "VS Code",
  "explorer.exe": "File Explorer",
  "python.exe": "Python",
  "pythonw.exe": "Python",
};

function isInvalidAppName(name) {
  const text = String(name || "").trim();
  if (!text || text.toLowerCase() === "unknown") return true;
  const lower = text.toLowerCase();
  return lower.includes("://") || lower.includes("media-stream") || lower.startsWith("current-web-contents");
}

function isBrowserAppName(name) {
  return /chrome|firefox|edge|opera|brave|safari|vivaldi|browser|chromium/i.test(String(name || ""));
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

function normalizeAppName(raw) {
  const name = String(raw || "").trim();
  if (isInvalidAppName(name)) return null;
  const mapped = APP_EXE_DISPLAY_NAMES[name.toLowerCase()];
  if (mapped) return mapped;
  if (name.toLowerCase().endsWith(".exe")) {
    const stem = name.slice(0, -4).replace(/\./g, " ").trim();
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : null;
  }
  return name;
}

/**
 * Authenticated member from req context (auth middleware).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("node:http").IncomingMessage} req
 */
async function resolveMember(db, req) {
  const viewer = getAuthContext(req);
  if (!viewer) return null;
  const snap = await db.collection("members").doc(viewer.memberId).get();
  const data = snap.exists ? snap.data() || {} : {};
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
  return findOpenPgSession(memberId);
}

function normalizeSession(id, data) {
  return {
    id,
    memberId: data.member_id,
    status: data.status,
    startedAt: toIso(data.started_at),
    endedAt: toIso(data.ended_at),
    activeSeconds: typeof data.active_seconds === "number" ? data.active_seconds : 0,
    idleSeconds: typeof data.idle_seconds === "number" ? data.idle_seconds : 0,
    taskId: data.task_id ?? null,
    updatedAt: toIso(data.updated_at),
    screenshotsEnabled: isActivityScreenshotsEnabled(),
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
        data: open ? normalizeSession(open.id, open) : null,
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
        const memberSnap = await db.collection("members").doc(member.memberId).get();
        const memberRow = memberSnap.data() || {};
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

      if (action === "start") {
        if (!open) {
          const id = crypto.randomUUID();
          open = await createPgSession({
            id,
            memberId: member.memberId,
            taskId,
            status: "active",
            startedAt: now,
            endedAt: null,
            activeSeconds: activeSeconds ?? 0,
            idleSeconds: idleSeconds ?? 0,
            updatedAt: now,
          });
        } else if (open.status !== "active") {
          await updatePgSession(open.id, {
            status: "active",
            updatedAt: now,
            ...(taskId ? { taskId } : {}),
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
            ...(activeSeconds !== undefined ? { activeSeconds } : {}),
            ...(idleSeconds !== undefined ? { idleSeconds } : {}),
          });
          open.status = "active";
        } else {
          const id = crypto.randomUUID();
          open = await createPgSession({
            id,
            memberId: member.memberId,
            taskId,
            status: "active",
            startedAt: now,
            endedAt: null,
            activeSeconds: activeSeconds ?? 0,
            idleSeconds: idleSeconds ?? 0,
            updatedAt: now,
          });
        }
      } else if (action === "stop") {
        if (open) {
          await updatePgSession(open.id, {
            status: "stopped",
            endedAt: now,
            updatedAt: now,
            ...(activeSeconds !== undefined ? { activeSeconds } : {}),
            ...(idleSeconds !== undefined ? { idleSeconds } : {}),
          });
          open = null;
        }
      } else if (action === "sync" && open) {
        await updatePgSession(open.id, {
          updatedAt: now,
          ...(taskId ? { taskId } : {}),
          ...(activeSeconds !== undefined ? { activeSeconds } : {}),
          ...(idleSeconds !== undefined ? { idleSeconds } : {}),
        });
      }

      const syncTaskId = taskId || open?.task_id || null;
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
          await syncTaskTimeTracking(db, {
            taskId: syncTaskId,
            userId: member.memberId,
            userName: member.name,
            action,
            activeSeconds,
            idleSeconds,
            sessionId: open?.id ?? null,
          });
        } catch (syncErr) {
          logSafeError("[activity/session task sync]", syncErr);
        }
      }

      sendJson(res, origin, 200, {
        success: true,
        data: open ? normalizeSession(open.id, open) : null,
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
      body = await readJsonBody(req);
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
        const taskSnap = await db.collection("tasks").doc(sessionTaskId).get();
        if (taskSnap.exists) {
          const title = taskSnap.data()?.title;
          sessionTaskTitle = typeof title === "string" && title.trim() ? title.trim() : null;
        }
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

      for (const ev of events.slice(0, 50)) {
        if (!ev || typeof ev !== "object") continue;
        const type = typeof ev.type === "string" ? ev.type : "";
        const id = crypto.randomUUID();

        if (type === "screenshot") {
          if (source === "agent" && !isDesktopAgentEventIngestEnabled()) continue;
          if (source !== "agent" && !isWebActivityCaptureEnabled()) continue;
          const imageData =
            typeof ev.imageData === "string"
              ? ev.imageData
              : typeof ev.image_data === "string"
                ? ev.image_data
                : "";
          if (!imageData || imageData.length > 900_000) continue;
          screenshotWrites.push(
            (async () => {
              const raw = imageData.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "");
              const buffer = Buffer.from(raw, "base64");
              const webp = await sharp(buffer)
                .resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true })
                .webp({ quality: 75 })
                .toBuffer();
              const capturedAt = ev.captured_at ? new Date(ev.captured_at) : now;
              // Stored as bytea in Postgres (image_data) - no per-screenshot GCS upload or
              // Firestore write. The archive job moves rows out to GCS once they age out.
              void insertActivityScreenshot({
                id,
                memberId: member.memberId,
                sessionId,
                taskId: sessionTaskId,
                taskTitle: sessionTaskTitle,
                imageData: webp,
                appName: typeof ev.appName === "string" ? ev.appName.slice(0, 200) : "Browser",
                pageTitle: typeof ev.pageTitle === "string" ? ev.pageTitle.slice(0, 300) : "",
                activityLevel:
                  typeof ev.activityLevel === "number"
                    ? Math.max(0, Math.min(100, Math.floor(ev.activityLevel)))
                    : 50,
                capturedAt,
                source,
              });
              count++;
            })(),
          );
          continue;
        }
        if (type === "app") {
          const appRow = {
            id,
            memberId: member.memberId,
            sessionId,
            taskId: sessionTaskId,
            taskTitle: sessionTaskTitle,
            appName: typeof ev.appName === "string" ? ev.appName.slice(0, 200) : "Unknown",
            pageTitle: typeof ev.pageTitle === "string" ? ev.pageTitle.slice(0, 300) : "",
            startedAt: now,
            durationSeconds: typeof ev.durationSeconds === "number" ? ev.durationSeconds : 30,
            source: typeof body.source === "string" ? body.source : "web",
          };
          void insertActivityAppLog(appRow);
          count++;
        } else if (type === "url") {
          const urlStr = typeof ev.url === "string" ? ev.url.slice(0, 2000) : "";
          const urlRow = {
            id,
            memberId: member.memberId,
            sessionId,
            taskId: sessionTaskId,
            taskTitle: sessionTaskTitle,
            url: urlStr,
            domain: parseDomain(urlStr),
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
          const taskTitle =
            (typeof d.task_title === "string" && d.task_title.trim()) || "No task linked";
          return {
            id: String(d.id),
            memberId,
            member: meta.name,
            avatar: meta.initials,
            project: taskTitle,
            taskTitle,
            capturedAt: captured || date.toISOString(),
            timestamp: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            time: date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            activityLevel: d.activity_level ?? 75,
            activeApp: d.app_name || "Browser",
            hasImage: d.has_image !== false,
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
          const memRow = byMember.get(memberIdKey) || { member: meta.name, avatar: meta.initials, totalSeconds: 0, apps: new Map() };
          memRow.totalSeconds += dur;
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
            category: "neutral",
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
          return {
            memberId: id,
            member: r.member,
            avatar: r.avatar,
            productiveTime: formatDur(r.totalSeconds),
            productivePercent: 100,
            neutralTime: "0m",
            unproductiveTime: "0m",
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
            category: "neutral",
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
      const memberSnap = await db.collection("members").doc(member.memberId).get();
      const row = memberSnap.data() || {};
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
    const session = await createAgentLinkSession(db, {
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
      const completed = await completeAgentLinkSession(db, linkToken, {
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
    const exchanged = await exchangeAgentLinkSession(db, linkToken, agentSecret);
    if (!exchanged.ok) {
      const code = exchanged.error === "Link session is not ready" ? 409 : 400;
      sendJson(res, origin, code, { success: false, error: exchanged.error });
      return true;
    }
    const memberId = typeof exchanged.data?.memberId === "string" ? exchanged.data.memberId : "";
    if (memberId) {
      await db.collection("members").doc(memberId).update({
        desktop_agent_linked_at: new Date(),
        agent_source: exchanged.data?.agentSource === "python" ? "python" : "electron",
        updated_by: exchanged.data?.agentSource === "python" ? "python" : "agent",
        updated_at: new Date(),
      });
    }
    sendJson(res, origin, 200, { success: true, data: exchanged.data });
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
      await db.collection("members").doc(member.memberId).update({
        ...(body?.source === "web"
          ? { web_capture_linked_at: new Date(), updated_by: "web" }
          : {
              desktop_agent_linked_at: new Date(),
              agent_source: body?.source === "python" ? "python" : "electron",
              updated_by: body?.source === "python" ? "python" : "agent",
            }),
        updated_at: new Date(),
      });
      sendJson(res, origin, 200, { success: true, data: { memberId: member.memberId } });
    } catch (e) {
      sendJson(res, origin, 401, { success: false, error: e instanceof Error ? e.message : "Unauthorized" });
    }
    return true;
  }

  return false;
}
