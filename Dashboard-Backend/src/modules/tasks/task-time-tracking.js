import {
  ensureAssignmentForUser,
  estimateAssignmentOvertimeSeconds,
  estimateAssignmentSeconds,
  estimateTaskDurationSeconds,
  getReviewQueue,
  isManagementRole,
  notifyAssignmentStatusChange,
  recomputeTaskStatus,
  reviewAssignment,
  updateAssignmentStatus,
  workingDaysForTask,
} from "./task-assignments.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { computeTimerAllowance, enforceTimerAllowanceOnSync } from "./timer-limit.service.js";
import {
  getTrackingRowPg,
  getTaskTrackingRowsPg,
  upsertTrackingRowPg,
  updateTrackingFieldsPg,
} from "../../lib/postgres/task-member-progress.service.js";
import { getTaskPg, updateTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import { getProjectPg } from "../../lib/postgres/projects-postgres.service.js";
import { getTaskAssignmentsPg, getInReviewAssignmentsForTaskPg } from "../../lib/postgres/task-assignments-postgres.service.js";

import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";

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

// Accepts a task_member_progress row (Postgres: member_id, last_started_at)
// directly now - kept the same output shape (userId, startedAt) so every
// caller downstream of this function needed zero changes.
function normalizeTracking(row) {
  if (!row) return row;
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.member_id ?? row.user_id,
    projectId: row.project_id ?? null,
    activeSeconds: typeof row.active_seconds === "number" ? row.active_seconds : 0,
    idleSeconds: typeof row.idle_seconds === "number" ? row.idle_seconds : 0,
    progressPercent: typeof row.progress_percentage === "number" ? row.progress_percentage : null,
    startedAt: toIso(row.last_started_at ?? row.started_at),
    lastActivityAt: toIso(row.last_activity_at),
    sessionId: row.session_id ?? null,
    reviewNotes: row.review_notes ?? "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function progressPercentFor(activeSeconds, estimatedSeconds) {
  if (!estimatedSeconds || estimatedSeconds <= 0) return null;
  return Math.min(100, Math.round((activeSeconds / estimatedSeconds) * 100));
}

/** Sum all member timers and persist task-level aggregates (TaskMemberProgress lives in task_time_tracking). */
export async function aggregateTaskProgress(db, taskId) {
  const taskData = await getTaskPg(taskId);
  if (!taskData) return null;

  const estimatedSeconds = estimateAssignmentSeconds(taskData);
  const trackingRows = await getTaskTrackingRowsPg(taskId);

  let totalActive = 0;
  let totalIdle = 0;
  const memberContributions = [];

  for (const row of trackingRows) {
    const active = Math.max(0, Math.floor(row.active_seconds ?? 0));
    const idle = Math.max(0, Math.floor(row.idle_seconds ?? 0));
    totalActive += active;
    totalIdle += idle;
    const memberProgress = progressPercentFor(active, estimatedSeconds);
    memberContributions.push({
      userId: row.member_id,
      activeSeconds: active,
      idleSeconds: idle,
      progressPercent: memberProgress,
      lastActivityAt: toIso(row.last_activity_at),
    });
    const existingProgress = typeof row.progress_percentage === "number" ? row.progress_percentage : null;
    if (existingProgress !== memberProgress) {
      await updateTrackingFieldsPg(taskId, row.member_id, { progress_percentage: memberProgress });
    }
  }

  const aggregatedProgress = progressPercentFor(totalActive, estimatedSeconds);
  const patch = {
    total_active_seconds: totalActive,
    total_idle_seconds: totalIdle,
    aggregated_progress_percent: aggregatedProgress,
  };
  await updateTaskPg(taskId, patch);

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

  const assignmentRows = await getTaskAssignmentsPg(taskId);

  let statusChanged = false;
  for (const row of assignmentRows) {
    const status = String(row.status ?? "todo").toLowerCase();
    // Only assignees who actually worked. Promoting a "todo" assignee because
    // a co-assignee hit the task's combined estimate marks work as reviewed/
    // done for someone who logged zero seconds, and inflates their
    // participation stats. Per-assignee completion ("done with my part") is
    // what the assignment rows model in the first place.
    if (status !== "in_progress") continue;
    const result = await updateAssignmentStatus(db, row.id, "in_review", userId);
    if (result && result.previousStatus !== result.nextStatus) {
      statusChanged = true;
      await notifyAssignmentStatusChange(db, {
        task,
        assigneeId: row.member_id,
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
  const task = await getTaskPg(taskId);
  if (!task) {
    throw new Error("Task not found");
  }
  const projectId = task.project_id ?? null;
  const now = new Date();
  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  let assignmentStatus = assignment.status;
  let statusChanged = false;

  const idle = Math.max(0, Math.floor(idleSeconds ?? 0));
  const enforced = await enforceTimerAllowanceOnSync(
    db,
    userId,
    task,
    Math.max(0, Math.floor(activeSeconds ?? 0)),
    action,
  );
  const active = enforced.activeSeconds;
  // Always recompute live from the task's current hours - assignment.expectedSeconds is a
  // snapshot only refreshed when the assignee list changes, so it silently goes stale (and
  // drops any overtime added later) if the task's hours are edited after assignment. Matches
  // what computeTimerAllowance already does for enforcement, so display and enforcement agree.
  const estimatedSeconds = estimateAssignmentSeconds(task);

  // Single upsert covers both create and update - upsertTrackingRowPg's
  // ON CONFLICT clause already keeps last_started_at COALESCE'd against the
  // existing value, matching the old create-vs-update branch's "set
  // started_at only if it wasn't already set" behavior without needing to
  // read-before-write here.
  const trackingRow = await upsertTrackingRowPg(
    {
      task_id: taskId,
      member_id: userId,
      project_id: projectId,
      active_seconds: active,
      idle_seconds: idle,
      progress_percentage: progressPercentFor(active, estimatedSeconds) ?? 0,
      last_started_at: action === "start" || action === "resume" ? now : null,
      last_activity_at: now,
      session_id: sessionId ?? null,
      action,
    },
    // Only "stop" may lower active_seconds - the desktop agent's
    // idle-escalation rewind (TC-4).
    { allowDecrease: action === "stop" },
  );

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

  const freshTaskData = (await getTaskPg(taskId)) ?? {};
  const freshAssignment = await ensureAssignmentForUser(db, taskId, userId);
  const timerAllowance = await computeTimerAllowance(db, userId, {
    ...freshTaskData,
    id: taskId,
  }, { currentCumulativeActiveSeconds: active });

  return {
    tracking: normalizeTracking(trackingRow),
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

/** Whole-task pool total for a shared_task_budget task - every assignee's
 * currently-persisted active_seconds summed together, computed fresh (not
 * from the periodically-recomputed total_active_seconds column, which can
 * lag). Undefined for a non-shared task; callers fall back to the member's
 * own activeSeconds in that case, unchanged from before this feature. */
async function sumAllAssigneesActiveSeconds(taskId) {
  const rows = await getTaskTrackingRowsPg(taskId);
  return rows.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.active_seconds) || 0)), 0);
}

export async function getTaskTimeTracking(db, taskId, userId, options = {}) {
  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  const trackingRow = await getTrackingRowPg(taskId, userId);
  const taskData = (await getTaskPg(taskId)) ?? {};
  const sharedBudget = taskData.shared_task_budget === true;
  // Always live - see the comment on the identical line in syncTaskTimeTracking above.
  const estimatedSeconds = estimateAssignmentSeconds(taskData);
  const overtimeSeconds = estimateAssignmentOvertimeSeconds(taskData);
  // Raw schedule breakdown ("7 days x 8h/day") - estimatedSeconds/overtimeSeconds
  // are these three numbers pre-multiplied together, which is enough to
  // enforce a cap but not enough to show the reader how the total was built.
  const workingDays = workingDaysForTask(taskData);
  const hoursPerDay = Number(taskData.duration_hours_per_day ?? taskData.durationHoursPerDay ?? 0);
  const overtimeHoursPerDay = Number(taskData.overtime_hours_per_day ?? taskData.overtimeHoursPerDay ?? 0);
  const includeMemberBreakdown = options.includeMemberBreakdown === true;

  // ID-3: the owning project's idle-time settings, fetched alongside the
  // task on every re-baseline so the desktop agent applies the right
  // project's threshold instead of one hardcoded/org-wide number - see
  // PLAN-agent-crash-safe-progress.md.
  const projectId = taskData.project_id ?? taskData.projectId ?? null;
  const project = projectId ? await getProjectPg(projectId) : null;
  const disableIdleTime = Boolean(project?.disable_idle_time ?? false);
  const idleTimeSeconds = Number(project?.idle_time_seconds ?? 450);

  let memberContributions = null;
  if (includeMemberBreakdown) {
    const aggregate = await aggregateTaskProgress(db, taskId);
    memberContributions = aggregate?.memberContributions ?? [];
    for (const row of memberContributions) {
      const memberData = (await getMemberByIdPg(row.userId)) || {};
      const first = typeof memberData.first_name === "string" ? memberData.first_name : "";
      const last = typeof memberData.last_name === "string" ? memberData.last_name : "";
      row.employeeName =
        `${first} ${last}`.trim() ||
        (typeof memberData.display_name === "string" ? memberData.display_name : "") ||
        "Unknown";
    }
  }

  if (!trackingRow) {
    const timerAllowance = await computeTimerAllowance(db, userId, {
      ...taskData,
      id: taskId,
    }, { currentCumulativeActiveSeconds: 0 });
    // Other assignees may already have logged time even though this member
    // hasn't started yet - a shared pool's "Task budget left" has to reflect
    // that, not read as if nothing has been spent.
    const sharedActiveSeconds = sharedBudget ? await sumAllAssigneesActiveSeconds(taskId) : 0;
    return {
      tracking: null,
      activeSeconds: sharedBudget ? sharedActiveSeconds : 0,
      idleSeconds: 0,
      taskStatus: taskData.status ?? "todo",
      assignmentStatus: assignment.status,
      assignmentId: assignment.id,
      estimatedSeconds,
      overtimeSeconds,
      workingDays,
      hoursPerDay,
      overtimeHoursPerDay,
      progressPercent: null,
      totalActiveSeconds: taskData.total_active_seconds ?? 0,
      totalIdleSeconds: taskData.total_idle_seconds ?? 0,
      aggregatedProgressPercent: taskData.aggregated_progress_percent ?? null,
      memberContributions,
      timerAllowance,
      disableIdleTime,
      idleTimeSeconds,
      sharedBudget,
    };
  }

  const tracking = normalizeTracking(trackingRow);
  const timerAllowance = await computeTimerAllowance(db, userId, {
    ...taskData,
    id: taskId,
  }, { currentCumulativeActiveSeconds: tracking.activeSeconds });
  const wholeTaskActiveSeconds = sharedBudget
    ? await sumAllAssigneesActiveSeconds(taskId)
    : tracking.activeSeconds;

  return {
    tracking,
    // "Today, this task" stays this member's own worked-today figure
    // (timerAllowance.workedTodayOnTaskSeconds, unaffected by this field) -
    // this activeSeconds is the whole-task lifetime total that "Task budget
    // left" is computed from, which the shared pool changes the meaning of.
    activeSeconds: wholeTaskActiveSeconds,
    idleSeconds: tracking.idleSeconds,
    taskStatus: taskData.status ?? "todo",
    assignmentStatus: assignment.status,
    assignmentId: assignment.id,
    estimatedSeconds,
    overtimeSeconds,
    workingDays,
    hoursPerDay,
    overtimeHoursPerDay,
    progressPercent: tracking.progressPercent ?? progressPercentFor(tracking.activeSeconds, estimatedSeconds),
    totalActiveSeconds: sharedBudget ? wholeTaskActiveSeconds : (taskData.total_active_seconds ?? tracking.activeSeconds),
    totalIdleSeconds: taskData.total_idle_seconds ?? tracking.idleSeconds,
    aggregatedProgressPercent: taskData.aggregated_progress_percent ?? null,
    memberContributions,
    timerAllowance,
    disableIdleTime,
    idleTimeSeconds,
    sharedBudget,
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
  const inReviewRows = await getInReviewAssignmentsForTaskPg(taskId);
  if (!inReviewRows.length) throw new Error("No assignment in review for this task");

  const mappedDecision = decision === "rework" ? "reject" : decision;
  // Every in-review row, not just the first: getInReviewAssignmentsForTaskPg
  // has no ORDER BY, so "the first" was whichever row Postgres happened to
  // return, leaving co-assignees stuck in review while the API reported
  // success. Matches the sibling POST /api/tasks/:taskId/review endpoint.
  let last = null;
  for (const row of inReviewRows) {
    last = await reviewAssignment(db, {
      assignmentId: row.id,
      reviewerId,
      reviewerName,
      decision: mappedDecision,
      notes,
    });
  }
  return last;
}
