import { requireAuthContext } from "../../http/auth-context.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";
import { readJsonBody } from "../../http/read-json-body.js";
import { sendJson } from "../../http/response.js";
import { assertCanReviewTasks, assertTaskAccessible, canAccessTask, canSyncTaskAssignments } from "../../http/task-access.js";
import { logSafeError } from "../../http/sanitize-error.js";
import { rejectUnknownFields } from "../../http/validate-body.js";
import {
  getManagementTaskTrackingRows,
  getTaskTimeTracking,
  isManagementRole,
  reviewTaskTracking,
  syncTaskTimeTracking,
} from "./task-time-tracking.js";
import {
  blockTaskForUser,
  getReviewQueue,
  getTaskParticipation,
  isReviewCenterRole,
  migrateTaskAssignments,
  reviewAssignment,
  startTaskForUser,
  syncTaskAssignments,
} from "./task-assignments.js";
import {
  enrichTaskIds,
  getEnrichedTaskById,
  listTasksForAssignee,
} from "./task-assignee-api.js";
import { getTaskPg, updateTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import crypto from "node:crypto";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { getInReviewAssignmentsForTaskPg, hasAssignmentPg } from "../../lib/postgres/task-assignments-postgres.service.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string|undefined} origin
 * @returns {Promise<boolean>}
 */
export async function routeTasks(req, res, url, db, origin) {
  const pn = url.pathname.replace(/^\/api\/v1\//, "/api/");

  if (pn === "/api/tasks" && req.method === "GET") {
    const assigneeFilter =
      url.searchParams.get("assigned_to") ?? url.searchParams.get("assignedTo");
    if (assigneeFilter) {
      const viewer = requireAuthContext(req, res, origin);
      if (!viewer) return true;
      try {
        const data = await listTasksForAssignee(req, db, url, assigneeFilter);
        sendJson(res, origin, 200, { success: true, data });
      } catch (e) {
        logSafeError("[tasks list assignee]", e);
        sendJson(res, origin, 500, {
          success: false,
          error: e instanceof Error ? e.message : "Failed to load assigned tasks",
        });
      }
      return true;
    }
  }

  const taskDetailMatch = /^\/api\/tasks\/([^/]+)$/.exec(pn);
  if (taskDetailMatch && req.method === "GET") {
    const taskId = taskDetailMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const data = await getEnrichedTaskById(req, db, taskId);
      if (!data) {
        sendJson(res, origin, 404, { success: false, error: "Not found" });
        return true;
      }
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks GET]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load task",
      });
    }
    return true;
  }

  if (pn === "/api/tasks/enrich" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const taskIds = Array.isArray(body?.taskIds)
      ? body.taskIds.filter((id) => typeof id === "string" && id.trim())
      : [];
    rejectUnknownFields(body, ["taskIds"]);
    try {
      const accessibleIds = [];
      for (const taskId of taskIds) {
        // canAccessTask always returns an object ({allowed, status, task}),
        // never undefined - checking the object itself was always truthy,
        // so this never actually filtered anything.
        const access = await canAccessTask(db, viewer.memberId, viewer.roleName, taskId);
        if (access.allowed) {
          accessibleIds.push(taskId);
        }
      }
      const data = await enrichTaskIds(db, accessibleIds);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/enrich]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to enrich tasks",
      });
    }
    return true;
  }

  // GET /api/task-assignments/review-queue
  if (pn === "/api/task-assignments/review-queue" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    // Employee tier may open this too - getReviewQueue itself scopes their
    // rows down to their own assignments only.
    if (!isReviewCenterRole(viewer.roleName) && !isEmployeeRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only authorized roles can access the review center" });
      return true;
    }
    try {
      const filters = {
        projectId: url.searchParams.get("projectId") || undefined,
        memberId: url.searchParams.get("memberId") || undefined,
        priority: url.searchParams.get("priority") || undefined,
        status: url.searchParams.get("status") || undefined,
      };
      const data = await getReviewQueue(db, viewer.memberId, viewer.roleName, filters);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[task-assignments/review-queue]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load review queue",
      });
    }
    return true;
  }

  // POST /api/task-assignments/migrate
  if (pn === "/api/task-assignments/migrate" && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management roles can migrate assignments" });
      return true;
    }
    try {
      const data = await migrateTaskAssignments(db);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[task-assignments/migrate]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to migrate assignments",
      });
    }
    return true;
  }

  const assignmentReviewMatch = /^\/api\/task-assignments\/([^/]+)\/review$/.exec(pn);
  if (assignmentReviewMatch && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management roles can review assignments." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const assignmentId = assignmentReviewMatch[1];
    const decision = typeof body.decision === "string" ? body.decision.trim().toLowerCase() : "";
    const notes = typeof body.notes === "string" ? body.notes : "";
    if (decision !== "approve" && decision !== "reject") {
      sendJson(res, origin, 400, { success: false, error: "decision must be approve or reject" });
      return true;
    }
    try {
      const memberRow = await getMemberByIdPg(viewer.memberId);
      const first = typeof memberRow?.first_name === "string" ? memberRow.first_name : "";
      const last = typeof memberRow?.last_name === "string" ? memberRow.last_name : "";
      const reviewerName = `${first} ${last}`.trim() || "Unknown";
      const data = await reviewAssignment(db, {
        assignmentId,
        reviewerId: viewer.memberId,
        reviewerName,
        decision,
        notes,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[task-assignments/review]", e);
      const message = e instanceof Error ? e.message : "Failed to review assignment";
      if (message.includes("not in review")) {
        // Case 27 - another reviewer's decision landed first, not a
        // permissions problem. A clean 409 instead of the 403 this used to
        // share with the out-of-scope case, so the UI can offer a reload
        // instead of reading it as "you're not allowed to do this."
        sendJson(res, origin, 409, {
          success: false,
          code: "already_reviewed",
          error: "This assignment was already reviewed by someone else. Reload to see the outcome.",
        });
        return true;
      }
      const status = message.includes("authorized") ? 403 : 500;
      sendJson(res, origin, status, { success: false, error: message });
    }
    return true;
  }

  const taskAssignmentsMatch = /^\/api\/tasks\/([^/]+)\/assignments$/.exec(pn);
  if (taskAssignmentsMatch && req.method === "GET") {
    const taskId = taskAssignmentsMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    const manageView =
      url.searchParams.get("manage") === "1" &&
      (await canSyncTaskAssignments(
        db,
        access.viewer.memberId,
        access.viewer.roleName,
        access.task,
      ));
    try {
      const data = await getTaskParticipation(
        db,
        taskId,
        access.viewer.memberId,
        access.viewer.roleName,
        { viewAll: manageView },
      );
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/assignments GET]", e);
      const message = e instanceof Error ? e.message : "Failed to load assignments";
      sendJson(res, origin, message === "Task not found" ? 404 : 500, { success: false, error: message });
    }
    return true;
  }

  const taskAssignmentStartMatch = /^\/api\/tasks\/([^/]+)\/assignments\/start$/.exec(pn);
  if (taskAssignmentStartMatch && req.method === "POST") {
    const taskId = taskAssignmentStartMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    if (!isManagementRole(access.viewer.roleName)) {
      const task = access.task;
      const primaryAssignee =
        typeof task.assigned_to === "string"
          ? task.assigned_to
          : typeof task.assignedTo === "string"
            ? task.assignedTo
            : "";
      if (primaryAssignee !== access.viewer.memberId) {
        const isAssigned = await hasAssignmentPg(taskId, access.viewer.memberId);
        if (!isAssigned) {
          sendJson(res, origin, 403, {
            success: false,
            error: "Only assigned members can start this task.",
          });
          return true;
        }
      }
    }
    try {
      const memberRow = await getMemberByIdPg(access.viewer.memberId);
      const first = typeof memberRow?.first_name === "string" ? memberRow.first_name : "";
      const last = typeof memberRow?.last_name === "string" ? memberRow.last_name : "";
      const userName = `${first} ${last}`.trim() || "Unknown";
      const data = await startTaskForUser(db, {
        taskId,
        userId: access.viewer.memberId,
        userName,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/assignments/start]", e);
      const message = e instanceof Error ? e.message : "Failed to start task";
      sendJson(res, origin, message === "Task not found" ? 404 : 500, { success: false, error: message });
    }
    return true;
  }

  // POST /api/tasks/:taskId/assignments/block - self-service "I'm blocked,
  // waiting on X", distinct from the whole task being blocked (board drag).
  // Same access model as .../start: management bypasses the "must be
  // assigned" check, but the action always applies to the viewer's own
  // assignment, never someone else's on their behalf.
  const taskAssignmentBlockMatch = /^\/api\/tasks\/([^/]+)\/assignments\/block$/.exec(pn);
  if (taskAssignmentBlockMatch && req.method === "POST") {
    const taskId = taskAssignmentBlockMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    if (!isManagementRole(access.viewer.roleName)) {
      const task = access.task;
      const primaryAssignee =
        typeof task.assigned_to === "string"
          ? task.assigned_to
          : typeof task.assignedTo === "string"
            ? task.assignedTo
            : "";
      if (primaryAssignee !== access.viewer.memberId) {
        const isAssigned = await hasAssignmentPg(taskId, access.viewer.memberId);
        if (!isAssigned) {
          sendJson(res, origin, 403, {
            success: false,
            error: "Only assigned members can block this task.",
          });
          return true;
        }
      }
    }
    try {
      const memberRow = await getMemberByIdPg(access.viewer.memberId);
      const first = typeof memberRow?.first_name === "string" ? memberRow.first_name : "";
      const last = typeof memberRow?.last_name === "string" ? memberRow.last_name : "";
      const userName = `${first} ${last}`.trim() || "Unknown";
      const data = await blockTaskForUser(db, {
        taskId,
        userId: access.viewer.memberId,
        userName,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/assignments/block]", e);
      const message = e instanceof Error ? e.message : "Failed to block task";
      sendJson(res, origin, message === "Task not found" ? 404 : 500, { success: false, error: message });
    }
    return true;
  }

  if (taskAssignmentsMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const taskId = taskAssignmentsMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    const canSync = await canSyncTaskAssignments(
      db,
      access.viewer.memberId,
      access.viewer.roleName,
      access.task,
    );
    if (!canSync) {
      sendJson(res, origin, 403, {
        success: false,
        error: "You do not have permission to update task assignments.",
      });
      return true;
    }
    const assigneeIds = Array.isArray(body.assigneeIds)
      ? body.assigneeIds.filter((id) => typeof id === "string")
      : [];
    const removeUnlisted = body.removeUnlisted === true;
    try {
      const data = await syncTaskAssignments(db, taskId, assigneeIds, { removeUnlisted });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/assignments]", e);
      const message = e instanceof Error ? e.message : "Failed to sync assignments";
      const isWorkload = message.includes("daily limit") || message.includes("weekly limit");
      sendJson(res, origin, message === "Task not found" ? 404 : isWorkload ? 400 : 500, {
        success: false,
        error: message,
      });
    }
    return true;
  }

  // GET /api/task-time-tracking/management
  if (pn === "/api/task-time-tracking/management" && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    if (!isReviewCenterRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only authorized roles can view task tracking" });
      return true;
    }
    try {
      const filters = {
        projectId: url.searchParams.get("projectId") || undefined,
        memberId: url.searchParams.get("memberId") || undefined,
        status: url.searchParams.get("status") || undefined,
      };
      const data = await getManagementTaskTrackingRows(db, viewer.memberId, viewer.roleName, filters);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[task-time-tracking/management]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load task tracking rows",
      });
    }
    return true;
  }

  const taskTimeTrackingReviewMatch = /^\/api\/tasks\/([^/]+)\/time-tracking\/review$/.exec(pn);
  if (taskTimeTrackingReviewMatch && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const taskId = taskTimeTrackingReviewMatch[1];
    const decision = typeof body.decision === "string" ? body.decision.trim().toLowerCase() : "";
    const notes = typeof body.notes === "string" ? body.notes : "";
    if (decision !== "approve" && decision !== "rework" && decision !== "reject") {
      sendJson(res, origin, 400, { success: false, error: "decision must be approve, reject, or rework" });
      return true;
    }
    try {
      const memberRow = await getMemberByIdPg(viewer.memberId);
      const first = typeof memberRow?.first_name === "string" ? memberRow.first_name : "";
      const last = typeof memberRow?.last_name === "string" ? memberRow.last_name : "";
      const reviewerName = `${first} ${last}`.trim() || "Unknown";
      const mappedDecision = decision === "rework" ? "reject" : decision;
      const data = await reviewTaskTracking(db, {
        taskId,
        reviewerId: viewer.memberId,
        reviewerName,
        decision: mappedDecision,
        notes,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/time-tracking/review]", e);
      const message = e instanceof Error ? e.message : "Failed to review task tracking";
      if (message.includes("not in review")) {
        // Case 27 - see the same branch in the /task-assignments/review route above.
        sendJson(res, origin, 409, {
          success: false,
          code: "already_reviewed",
          error: "This assignment was already reviewed by someone else. Reload to see the outcome.",
        });
        return true;
      }
      const status = message.includes("management") ? 403 : 500;
      sendJson(res, origin, status, { success: false, error: message });
    }
    return true;
  }

  const taskTimeTrackingMatch = /^\/api\/tasks\/([^/]+)\/time-tracking$/.exec(pn);

  const taskProgressMeMatch = /^\/api\/tasks\/([^/]+)\/progress\/me$/.exec(pn);
  if (taskProgressMeMatch && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const taskId = taskProgressMeMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const progressData = await getTaskTimeTracking(db, taskId, viewer.memberId, {
        includeMemberBreakdown: false,
      });
      sendJson(res, origin, 200, {
        success: true,
        data: {
          taskId,
          memberId: viewer.memberId,
          status: progressData.taskStatus,
          assignmentStatus: progressData.assignmentStatus,
          plannedDurationSeconds: progressData.estimatedSeconds,
          myActiveSeconds: progressData.activeSeconds,
          myIdleSeconds: progressData.idleSeconds,
          myProgressPercent: progressData.progressPercent,
          lastStartedAt: progressData.tracking?.startedAt ?? null,
          lastActivityAt: progressData.tracking?.lastActivityAt ?? null,
          source: "postgres",
        },
      });
    } catch (e) {
      logSafeError("[tasks/progress/me GET]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load member progress",
      });
    }
    return true;
  }

  const taskProgressMatch = /^\/api\/tasks\/([^/]+)\/progress$/.exec(pn);
  if (taskProgressMatch && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const taskId = taskProgressMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    if (!isManagementRole(viewer.roleName)) {
      sendJson(res, origin, 403, { success: false, error: "Only management can view task progress breakdown" });
      return true;
    }
    try {
      const progressData = await getTaskTimeTracking(db, taskId, viewer.memberId, {
        includeMemberBreakdown: true,
      });
      const planned = progressData.estimatedSeconds ?? null;
      const totalActive = Number(progressData.totalActiveSeconds ?? 0);
      const totalIdle = Number(progressData.totalIdleSeconds ?? 0);
      const overallProgress =
        planned && planned > 0 ? Math.min(100, Math.round((totalActive / planned) * 100)) : null;
      sendJson(res, origin, 200, {
        success: true,
        data: {
          taskId,
          status: progressData.taskStatus,
          plannedDurationSeconds: planned,
          totalActiveSeconds: totalActive,
          totalIdleSeconds: totalIdle,
          overallProgressPercent: overallProgress ?? progressData.aggregatedProgressPercent,
          contributingMembers: progressData.memberContributions?.length ?? 0,
          memberBreakdown: progressData.memberContributions ?? [],
          source: "postgres",
        },
      });
    } catch (e) {
      logSafeError("[tasks/progress GET]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load task progress",
      });
    }
    return true;
  }

  if (taskTimeTrackingMatch && req.method === "GET") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    const taskId = taskTimeTrackingMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const includeMemberBreakdown = isManagementRole(viewer.roleName);
      const data = await getTaskTimeTracking(db, taskId, viewer.memberId, { includeMemberBreakdown });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/time-tracking GET]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load task time tracking",
      });
    }
    return true;
  }

  if (taskTimeTrackingMatch && req.method === "POST") {
    const viewer = requireAuthContext(req, res, origin);
    if (!viewer) return true;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      sendJson(res, origin, 400, { success: false, error: e instanceof Error ? e.message : "Invalid body" });
      return true;
    }
    const taskId = taskTimeTrackingMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    const allowed = new Set(["start", "idle", "resume", "stop", "sync"]);
    if (!allowed.has(action)) {
      sendJson(res, origin, 400, { success: false, error: "action must be start, idle, resume, stop, or sync" });
      return true;
    }
    rejectUnknownFields(body, ["action", "activeSeconds", "idleSeconds", "sessionId"]);
    if (typeof body.memberId === "string" || typeof body.userId === "string") {
      sendJson(res, origin, 400, { success: false, error: "memberId/userId must not be sent; timer is scoped to the authenticated member" });
      return true;
    }
    const activeSeconds =
      typeof body.activeSeconds === "number" ? Math.max(0, Math.floor(body.activeSeconds)) : 0;
    const idleSeconds = typeof body.idleSeconds === "number" ? Math.max(0, Math.floor(body.idleSeconds)) : 0;
    const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;
    try {
      const memberRow = await getMemberByIdPg(viewer.memberId);
      const first = typeof memberRow?.first_name === "string" ? memberRow.first_name : "";
      const last = typeof memberRow?.last_name === "string" ? memberRow.last_name : "";
      const userName = `${first} ${last}`.trim() || "Unknown";
      const data = await syncTaskTimeTracking(db, {
        taskId,
        userId: viewer.memberId,
        userName,
        action,
        activeSeconds,
        idleSeconds,
        sessionId,
      });
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/time-tracking POST]", e);
      const message = e instanceof Error ? e.message : "Failed to sync task time tracking";
      const code = typeof e === "object" && e !== null && "code" in e ? String(/** @type {{ code?: unknown }} */ (e).code) : "";
      const status =
        message === "Task not found" ? 404 : code === "TIMER_LIMIT_REACHED" ? 400 : 500;
      sendJson(res, origin, status, { success: false, error: message });
    }
    return true;
  }

  // GET /api/tasks/:taskId/hours - Get all hours for a task
  const taskHoursMatch = /^\/api\/tasks\/([^/]+)\/hours$/.exec(pn);
  if (taskHoursMatch && req.method === "GET") {
    const taskId = taskHoursMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const data = await pgQuery("SELECT * FROM task_hours WHERE task_id = $1 ORDER BY created_at ASC", [taskId]);
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/hours]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load task hours",
      });
    }
    return true;
  }

  // GET /api/tasks/:taskId/hours/:userId - Get hours for a specific user on a task
  const taskUserHoursMatch = /^\/api\/tasks\/([^/]+)\/hours\/([^/]+)$/.exec(pn);
  if (taskUserHoursMatch && req.method === "GET") {
    const taskId = taskUserHoursMatch[1];
    const userId = taskUserHoursMatch[2];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    const viewer = access.viewer;
    const canRead =
      userId === viewer.memberId || isManagementRole(viewer.roleName) || isReviewCenterRole(viewer.roleName);
    if (!canRead) {
      sendJson(res, origin, 404, { success: false, error: "Not found." });
      return true;
    }
    try {
      const data = await pgQuery(
        "SELECT * FROM task_hours WHERE task_id = $1 AND user_id = $2 ORDER BY created_at ASC",
        [taskId, userId],
      );
      sendJson(res, origin, 200, { success: true, data });
    } catch (e) {
      logSafeError("[tasks/hours/user]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load task hours for user",
      });
    }
    return true;
  }

  // POST /api/tasks/:taskId/hours - Create hours for a task
  if (taskHoursMatch && req.method === "POST") {
    const taskId = taskHoursMatch[1];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const body = await readJsonBody(req);
      rejectUnknownFields(body, ["hours_spent", "hoursSpent"]);
      const hoursSpent = body.hours_spent ?? body.hoursSpent;
      if (hoursSpent === undefined || hoursSpent === null) {
        sendJson(res, origin, 400, { success: false, error: "hours_spent is required" });
        return true;
      }

      const viewer = access.viewer;
      const userId = viewer.memberId;
      const id = crypto.randomUUID();
      const rows = await pgQuery(
        `INSERT INTO task_hours
          (id, task_id, user_id, hours_spent, status, submitted_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'submitted', now(), $5, $5)
         RETURNING *`,
        [id, taskId, userId, Number(hoursSpent), userId],
      );
      sendJson(res, origin, 201, { success: true, data: rows[0] });
    } catch (e) {
      logSafeError("[tasks/hours/create]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to create task hours",
      });
    }
    return true;
  }

  // PUT /api/tasks/:taskId/hours/:hoursId - Update hours
  const updateHoursMatch = /^\/api\/tasks\/([^/]+)\/hours\/([^/]+)$/.exec(pn);
  if (updateHoursMatch && req.method === "PUT") {
    const taskId = updateHoursMatch[1];
    const hoursId = updateHoursMatch[2];
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const body = await readJsonBody(req);
      rejectUnknownFields(body, ["hours_spent", "hoursSpent", "status"]);
      const hoursSpent = body.hours_spent ?? body.hoursSpent;
      const status = body.status;

      const existingRows = await pgQuery("SELECT * FROM task_hours WHERE id = $1 LIMIT 1", [hoursId]);
      const row = existingRows[0];

      if (!row || (row.task_id && row.task_id !== taskId)) {
        sendJson(res, origin, 404, { success: false, error: "Not found." });
        return true;
      }
      const ownerId = row.user_id ?? "";
      const viewer = access.viewer;
      const canEdit =
        ownerId === viewer.memberId || isManagementRole(viewer.roleName) || isReviewCenterRole(viewer.roleName);
      if (!canEdit) {
        sendJson(res, origin, 403, { success: false, error: "Insufficient permissions." });
        return true;
      }

      const nextHoursSpent = hoursSpent !== undefined ? Number(hoursSpent) : row.hours_spent;
      const nextStatus = status !== undefined ? status : row.status;
      const rows = await pgQuery(
        `UPDATE task_hours SET
           hours_spent = $2, status = $3,
           submitted_at = CASE WHEN $3 = 'submitted' THEN now() ELSE submitted_at END,
           updated_at = now(), updated_by = $4
         WHERE id = $1
         RETURNING *`,
        [hoursId, nextHoursSpent, nextStatus, viewer.memberId],
      );
      sendJson(res, origin, 200, { success: true, data: rows[0] });
    } catch (e) {
      logSafeError("[tasks/hours/update]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to update task hours",
      });
    }
    return true;
  }

  // POST /api/tasks/:taskId/review - Submit task review
  const taskReviewMatch = /^\/api\/tasks\/([^/]+)\/review$/.exec(pn);
  if (taskReviewMatch && req.method === "POST") {
    const taskId = taskReviewMatch[1];
    const reviewer = assertCanReviewTasks(req, res, origin);
    if (!reviewer) return true;
    const access = await assertTaskAccessible(req, res, origin, db, taskId);
    if (!access) return true;
    try {
      const body = await readJsonBody(req);
      rejectUnknownFields(body, ["decision"]);
      const decision = typeof body.decision === "string" ? body.decision.trim().toLowerCase() : "";

      if (decision !== "approved" && decision !== "rejected") {
        sendJson(res, origin, 400, { success: false, error: "Decision must be either 'approved' or 'rejected'" });
        return true;
      }

      const memberRow = await getMemberByIdPg(reviewer.memberId);
      const first = typeof memberRow?.first_name === "string" ? memberRow.first_name : "";
      const last = typeof memberRow?.last_name === "string" ? memberRow.last_name : "";
      const reviewerName = `${first} ${last}`.trim() || "Unknown";

      const inReviewRows = await getInReviewAssignmentsForTaskPg(taskId);

      const mappedDecision = decision === "approved" ? "approve" : "reject";
      if (inReviewRows.length > 0) {
        for (const row of inReviewRows) {
          await reviewAssignment(db, {
            assignmentId: row.id,
            reviewerId: reviewer.memberId,
            reviewerName,
            decision: mappedDecision,
            notes: "",
          });
        }
      } else {
        await updateTaskPg(taskId, {
          review_state: decision,
          reviewed_by: reviewer.memberId,
          reviewed_at: new Date(),
          updated_by: reviewer.memberId,
          ...(decision === "approved" ? { status: "done", completed: true } : { status: "in_progress", completed: false }),
        });
      }

      const updatedTask = await getTaskPg(taskId);
      sendJson(res, origin, 200, { success: true, data: updatedTask });
    } catch (e) {
      logSafeError("[tasks/review]", e);
      sendJson(res, origin, 500, {
        success: false,
        error: e instanceof Error ? e.message : "Failed to submit task review",
      });
    }
    return true;
  }

  return false;
}
