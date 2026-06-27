import crypto from "node:crypto";
import {
  ensureAssignmentForUser,
  estimateAssignmentSeconds,
  estimateTaskDurationSeconds,
  getReviewQueue,
  isManagementRole,
  notifyAssignmentStatusChange,
  recomputeTaskStatus,
  reviewAssignment,
  updateAssignmentStatus,
} from "./task-assignments.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { computeTimerAllowance, enforceTimerAllowanceOnSync } from "./timer-limit.service.js";

export { estimateAssignmentSeconds, estimateTaskDurationSeconds, isManagementRole };

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

function normalizeTracking(doc) {
  const d = doc.data ? doc.data() : doc;
  const id = doc.id ?? d.id;
  return {
    id,
    taskId: d.task_id,
    userId: d.user_id,
    projectId: d.project_id ?? null,
    activeSeconds: typeof d.active_seconds === "number" ? d.active_seconds : 0,
    idleSeconds: typeof d.idle_seconds === "number" ? d.idle_seconds : 0,
    progressPercent: typeof d.progress_percentage === "number" ? d.progress_percentage : null,
    startedAt: toIso(d.started_at),
    lastActivityAt: toIso(d.last_activity_at),
    sessionId: d.session_id ?? null,
    reviewNotes: d.review_notes ?? "",
    createdAt: toIso(d.created_at),
    updatedAt: toIso(d.updated_at),
  };
}

function progressPercentFor(activeSeconds, estimatedSeconds) {
  if (!estimatedSeconds || estimatedSeconds <= 0) return null;
  return Math.min(100, Math.round((activeSeconds / estimatedSeconds) * 100));
}

/** Sum all member timers and persist task-level aggregates (TaskMemberProgress lives in task_time_tracking). */
export async function aggregateTaskProgress(db, taskId) {
  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) return null;

  const taskData = taskSnap.data() ?? {};
  const estimatedSeconds = estimateAssignmentSeconds(taskData);
  const trackingSnap = await db
    .collection("task_time_tracking")
    .where("task_id", "==", taskId)
    .limit(100)
    .get();

  let totalActive = 0;
  let totalIdle = 0;
  const now = new Date();
  const memberContributions = [];

  for (const doc of trackingSnap.docs) {
    const d = doc.data() ?? {};
    const active = Math.max(0, Math.floor(d.active_seconds ?? 0));
    const idle = Math.max(0, Math.floor(d.idle_seconds ?? 0));
    totalActive += active;
    totalIdle += idle;
    const memberProgress = progressPercentFor(active, estimatedSeconds);
    memberContributions.push({
      userId: d.user_id,
      activeSeconds: active,
      idleSeconds: idle,
      progressPercent: memberProgress,
      lastActivityAt: toIso(d.last_activity_at),
    });
    const existingProgress = typeof d.progress_percentage === "number" ? d.progress_percentage : null;
    if (existingProgress !== memberProgress) {
      await doc.ref.update({ progress_percentage: memberProgress, updated_at: now });
    }
  }

  const aggregatedProgress = progressPercentFor(totalActive, estimatedSeconds);
  const patch = {
    total_active_seconds: totalActive,
    total_idle_seconds: totalIdle,
    aggregated_progress_percent: aggregatedProgress,
    updated_at: now,
  };
  await taskRef.update(patch);

  return {
    totalActiveSeconds: totalActive,
    totalIdleSeconds: totalIdle,
    aggregatedProgressPercent: aggregatedProgress,
    estimatedSeconds,
    memberContributions,
  };
}

async function maybePromoteTaskToReview(db, taskId, task, userId, userName, estimatedSeconds, totalActiveSeconds) {
  if (estimatedSeconds == null || totalActiveSeconds < estimatedSeconds) return false;

  const assignmentsSnap = await db
    .collection("task_assignments")
    .where("task_id", "==", taskId)
    .limit(50)
    .get();

  let statusChanged = false;
  for (const doc of assignmentsSnap.docs) {
    const status = String(doc.data()?.status ?? "todo").toLowerCase();
    if (status !== "in_progress" && status !== "todo") continue;
    const result = await updateAssignmentStatus(db, doc.id, "in_review", userId);
    if (result && result.previousStatus !== result.nextStatus) {
      statusChanged = true;
      await notifyAssignmentStatusChange(db, {
        task,
        assigneeId: doc.data()?.user_id,
        previousStatus: result.previousStatus,
        nextStatus: "in_review",
        actorName: userName || "A team member",
      });
    }
  }

  if (statusChanged) {
    await recomputeTaskStatus(db, taskId);
  }
  return statusChanged;
}

async function findTrackingDoc(db, taskId, userId) {
  const snap = await db
    .collection("task_time_tracking")
    .where("task_id", "==", taskId)
    .where("user_id", "==", userId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

/**
 * Sync timer counters for a task assignment. Backend is source of truth.
 */
export async function syncTaskTimeTracking(db, {
  taskId,
  userId,
  userName,
  action,
  activeSeconds,
  idleSeconds,
  sessionId,
}) {
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) {
    throw new Error("Task not found");
  }
  const task = { ...taskSnap.data(), id: taskId };
  const projectId = task.project_id ?? null;
  const now = new Date();
  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  let assignmentStatus = assignment.status;
  let statusChanged = false;

  let trackingDoc = await findTrackingDoc(db, taskId, userId);
  const idle = Math.max(0, Math.floor(idleSeconds ?? 0));
  const enforced = await enforceTimerAllowanceOnSync(
    db,
    userId,
    task,
    Math.max(0, Math.floor(activeSeconds ?? 0)),
    action,
  );
  const active = enforced.activeSeconds;
  const estimatedSeconds = assignment.expectedSeconds ?? estimateAssignmentSeconds(task);

  if (!trackingDoc) {
    const id = crypto.randomUUID();
    const row = {
      id,
      task_id: taskId,
      user_id: userId,
      project_id: projectId,
      active_seconds: active,
      idle_seconds: idle,
      started_at: action === "start" || action === "resume" ? now : null,
      last_activity_at: now,
      session_id: sessionId ?? null,
      review_notes: "",
      created_at: now,
      updated_at: now,
    };
    await db.collection("task_time_tracking").doc(id).set(row);
    trackingDoc = { id, data: () => row };
  } else {
    const patch = {
      active_seconds: active,
      idle_seconds: idle,
      last_activity_at: now,
      updated_at: now,
    };
    if (sessionId) patch.session_id = sessionId;
    if ((action === "start" || action === "resume") && !trackingDoc.data()?.started_at) {
      patch.started_at = now;
    }
    await db.collection("task_time_tracking").doc(trackingDoc.id).update(patch);
    trackingDoc = await db.collection("task_time_tracking").doc(trackingDoc.id).get();
  }

  if (action === "start" || action === "resume") {
    if (assignmentStatus === "todo" || assignmentStatus === "blocked") {
      const result = await updateAssignmentStatus(db, assignment.id, "in_progress", userId);
      if (result && result.previousStatus !== result.nextStatus) {
        statusChanged = true;
        assignmentStatus = result.nextStatus;
        await notifyAssignmentStatusChange(db, {
          task,
          assigneeId: userId,
          previousStatus: result.previousStatus,
          nextStatus: "in_progress",
          actorName: userName || "A team member",
        });
        await recomputeTaskStatus(db, taskId);
      }
    }
  }

  const aggregate = await aggregateTaskProgress(db, taskId);
  const reviewPromoted = await maybePromoteTaskToReview(
    db,
    taskId,
    task,
    userId,
    userName,
    aggregate?.estimatedSeconds ?? estimatedSeconds,
    aggregate?.totalActiveSeconds ?? active,
  );
  if (reviewPromoted) statusChanged = true;

  const freshTaskSnap = await db.collection("tasks").doc(taskId).get();
  const freshAssignment = await ensureAssignmentForUser(db, taskId, userId);
  const timerAllowance = await computeTimerAllowance(db, userId, {
    ...freshTaskSnap.data(),
    id: taskId,
  }, { currentCumulativeActiveSeconds: active });

  const freshTaskData = freshTaskSnap.data() ?? {};
  return {
    tracking: normalizeTracking(trackingDoc),
    activeSeconds: active,
    idleSeconds: idle,
    taskStatus: freshTaskData.status ?? "todo",
    assignmentStatus: freshAssignment.status,
    assignmentId: freshAssignment.id,
    estimatedSeconds,
    progressPercent: progressPercentFor(active, estimatedSeconds),
    totalActiveSeconds: aggregate?.totalActiveSeconds ?? freshTaskData.total_active_seconds ?? active,
    totalIdleSeconds: aggregate?.totalIdleSeconds ?? freshTaskData.total_idle_seconds ?? idle,
    aggregatedProgressPercent:
      aggregate?.aggregatedProgressPercent ?? freshTaskData.aggregated_progress_percent ?? null,
    statusChanged,
    timerAllowance,
    timerCapped: enforced.capped,
  };
}

export async function getTaskTimeTracking(db, taskId, userId, options = {}) {
  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  const doc = await findTrackingDoc(db, taskId, userId);
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  const taskData = taskSnap.data() ?? {};
  const estimatedSeconds = assignment.expectedSeconds ?? estimateAssignmentSeconds(taskData);
  const includeMemberBreakdown = options.includeMemberBreakdown === true;

  let memberContributions = null;
  if (includeMemberBreakdown) {
    const aggregate = await aggregateTaskProgress(db, taskId);
    memberContributions = aggregate?.memberContributions ?? [];
    for (const row of memberContributions) {
      const memberSnap = await db.collection("members").doc(row.userId).get();
      const memberData = memberSnap.exists ? memberSnap.data() : {};
      const first = typeof memberData.first_name === "string" ? memberData.first_name : "";
      const last = typeof memberData.last_name === "string" ? memberData.last_name : "";
      row.employeeName =
        `${first} ${last}`.trim() ||
        (typeof memberData.name === "string" ? memberData.name : "") ||
        "Unknown";
    }
  }

  if (!doc) {
    const timerAllowance = await computeTimerAllowance(db, userId, {
      ...taskData,
      id: taskId,
    }, { currentCumulativeActiveSeconds: 0 });
    return {
      tracking: null,
      activeSeconds: 0,
      idleSeconds: 0,
      taskStatus: taskData.status ?? "todo",
      assignmentStatus: assignment.status,
      assignmentId: assignment.id,
      estimatedSeconds,
      progressPercent: null,
      totalActiveSeconds: taskData.total_active_seconds ?? 0,
      totalIdleSeconds: taskData.total_idle_seconds ?? 0,
      aggregatedProgressPercent: taskData.aggregated_progress_percent ?? null,
      memberContributions,
      timerAllowance,
    };
  }

  const tracking = normalizeTracking(doc);
  const timerAllowance = await computeTimerAllowance(db, userId, {
    ...taskData,
    id: taskId,
  }, { currentCumulativeActiveSeconds: tracking.activeSeconds });

  return {
    tracking,
    activeSeconds: tracking.activeSeconds,
    idleSeconds: tracking.idleSeconds,
    taskStatus: taskData.status ?? "todo",
    assignmentStatus: assignment.status,
    assignmentId: assignment.id,
    estimatedSeconds,
    progressPercent: tracking.progressPercent ?? progressPercentFor(tracking.activeSeconds, estimatedSeconds),
    totalActiveSeconds: taskData.total_active_seconds ?? tracking.activeSeconds,
    totalIdleSeconds: taskData.total_idle_seconds ?? tracking.idleSeconds,
    aggregatedProgressPercent: taskData.aggregated_progress_percent ?? null,
    memberContributions,
    timerAllowance,
  };
}

export async function getManagementTaskTrackingRows(db, viewerMemberId, viewerRole, filters = {}) {
  const queue = await getReviewQueue(db, viewerMemberId, viewerRole, filters);
  const rows = [...queue.needsReview, ...queue.priorityMonitor];
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = row.assignmentId;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      id: row.assignmentId,
      taskId: row.taskId,
      userId: row.userId,
      projectId: row.projectId,
      activeSeconds: row.loggedSeconds,
      idleSeconds: row.idleSeconds,
      startedAt: row.startedAt,
      lastActivityAt: row.lastActivityAt,
      employeeName: row.employeeName,
      projectName: row.projectName,
      taskName: row.taskTitle,
      taskStatus: row.assignmentStatus,
      priority: row.priority,
      estimatedSeconds: row.expectedSeconds,
      progressPercent: row.progressPercent,
      assignmentId: row.assignmentId,
      needsReview: row.needsReview,
      isPriorityMonitor: row.isPriorityMonitor,
    });
  }
  return unique;
}

/** @deprecated Use reviewAssignment from task-assignments */
export async function reviewTaskTracking(db, { taskId, reviewerId, reviewerName, decision, notes }) {
  const assignmentSnap = await db
    .collection("task_assignments")
    .where("task_id", "==", taskId)
    .where("status", "==", "in_review")
    .limit(1)
    .get();
  if (assignmentSnap.empty) throw new Error("No assignment in review for this task");

  const mappedDecision = decision === "rework" ? "reject" : decision;
  return reviewAssignment(db, {
    assignmentId: assignmentSnap.docs[0].id,
    reviewerId,
    reviewerName,
    decision: mappedDecision,
    notes,
  });
}
