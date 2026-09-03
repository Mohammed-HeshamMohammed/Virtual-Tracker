import { validateAssigneeWorkLimits } from "./task-workload-validation.js";
import { estimateAssignmentSeconds, toIso } from "./task-schedule-math.js";
import { createNotification } from "../notifications/service.js";
import { getMemberAncestors, getVisibleMemberIds } from "../member-relationships/service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getProjectPg, listViewerProjectIdsPg, listProjectMembersPg } from "../../lib/postgres/projects-postgres.service.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { getTaskPg, listTasksPg, updateTaskPg } from "../../lib/postgres/tasks-postgres.service.js";
import {
  deleteAssignmentPg,
  findAssignmentPg,
  getAssignmentByIdPg,
  getAssignmentsForTasksPg,
  getTaskAssignmentsPg,
  getTaskIdsAssignedToMembersPg,
  listAllAssignmentsPg,
  updateAssignmentPg,
  upsertAssignmentPg,
} from "../../lib/postgres/task-assignments-postgres.service.js";
import {
  getTaskTrackingRowsPg,
  getAllTrackingRowsPg,
  updateTrackingFieldsPg,
} from "../../lib/postgres/task-member-progress.service.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";
import { normalizeRoleKey } from "../../http/role-key.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";

const REVIEW_CENTER_ROLES = new Set([
  "owner",
  "superadmin",
  "admin",
  "supermanager",
  "manager",
  "client",
]);
const MANAGEMENT_ROLES = new Set(["owner", "superadmin", "admin", "supermanager", "manager"]);
const LEADERSHIP_ROLES = new Set(["owner", "superadmin", "admin", "supermanager"]);
const HIGH_PRIORITIES = new Set(["high", "urgent"]);
const STARTED_ASSIGNMENT_STATUSES = new Set(["in_progress", "in_review", "done", "blocked"]);

export function isAssignmentStarted(status) {
  return STARTED_ASSIGNMENT_STATUSES.has(String(status ?? "").toLowerCase());
}

export function participationStatusLabel(status) {
  const s = String(status ?? "todo").toLowerCase();
  if (s === "todo") return "not_started";
  if (s === "done") return "completed";
  return s;
}

export function computeParticipationStats(assignments) {
  const required = assignments.filter((a) => a.required !== false);
  const total = required.length;
  const started = required.filter((a) => isAssignmentStarted(a.status)).length;
  const notStarted = Math.max(0, total - started);
  return {
    totalAssignees: total,
    startedAssignees: started,
    notStartedAssignees: notStarted,
    participationPercent: total > 0 ? Math.round((started / total) * 100) : null,
    allAssigneesStarted: total > 0 && started === total,
  };
}

function normalizeRole(roleName) {
  return normalizeRoleKey(roleName);
}

export {
  countWorkingDaysBetween,
  workingDaysForTask,
  estimateAssignmentSeconds,
  estimateAssignmentOvertimeSeconds,
  estimateTaskDurationSeconds,
} from "./task-schedule-math.js";

export function isManagementRole(roleName) {
  return MANAGEMENT_ROLES.has(normalizeRole(roleName));
}

export function isReviewCenterRole(roleName) {
  return REVIEW_CENTER_ROLES.has(normalizeRole(roleName));
}

function normalizeAssignment(doc) {
  const d = doc.data ? doc.data() : doc;
  const id = doc.id ?? d.id;
  return {
    id,
    taskId: d.task_id,
    userId: d.member_id,
    projectId: d.project_id ?? null,
    status: d.status ?? "todo",
    expectedSeconds: typeof d.expected_seconds === "number" ? d.expected_seconds : null,
    required: d.required !== false,
    reviewState: d.review_state ?? null,
    reviewedBy: d.reviewed_by ?? null,
    reviewedAt: toIso(d.reviewed_at),
    reviewNotes: d.review_notes ?? "",
    enteredReviewAt: toIso(d.entered_review_at),
    createdAt: toIso(d.created_at),
    updatedAt: toIso(d.updated_at),
  };
}

async function getDirectParentIds(_db, memberId) {
  const rows = await pgQuery(
    "SELECT parent_member_id FROM member_relationships WHERE child_member_id = $1 LIMIT 20",
    [memberId],
  );
  return rows.map((r) => r.parent_member_id).filter(Boolean);
}

async function getProjectMemberIds(db, projectId) {
  if (!projectId) return [];
  const rows = await listProjectMembersPg(projectId).catch(() => []);
  return rows.map((r) => r.member_id).filter(Boolean);
}

async function getProjectLeadershipIds(db, projectId, excludeMemberId) {
  const memberIds = await getProjectMemberIds(db, projectId);
  const recipients = new Set();
  for (const memberId of memberIds) {
    if (memberId === excludeMemberId) continue;
    const role = normalizeRole(await resolveMemberRoleName(db, memberId));
    if (LEADERSHIP_ROLES.has(role)) recipients.add(memberId);
  }
  return [...recipients];
}

async function notifyRecipients(db, recipientIds, payload) {
  const unique = [...new Set(recipientIds.filter(Boolean))];
  await Promise.all(
    unique.map((recipient_id) =>
      createNotification(db, { recipient_id, ...payload }).catch(() => null),
    ),
  );
}

async function notifyAssignmentStatusChange(db, params) {
  try {
    await dispatchAssignmentStatusNotification(db, params);
  } catch (err) {
    logSafeWarn("[task-assignments] assignment status notification failed", err);
  }
}

async function dispatchAssignmentStatusNotification(
  db,
  { task, assigneeId, previousStatus, nextStatus, actorName },
) {
  const taskTitle = task.title || "Task";
  const projectId = task.project_id ?? task.projectId ?? null;
  const link = projectId ? `pm-tasks?project=${projectId}` : "pm-tasks";

  if (nextStatus === "in_progress" && previousStatus !== "in_progress") {
    const parents = await getDirectParentIds(db, assigneeId);
    const projectLeaders = await getProjectLeadershipIds(db, projectId, assigneeId);
    await notifyRecipients(db, [...parents, ...projectLeaders], {
      type: "task_timer_started",
      title: "Task started",
      message: `${actorName} started working on "${taskTitle}".`,
      link,
    });
    return;
  }

  if (nextStatus === "in_review") {
    const parents = await getDirectParentIds(db, assigneeId);
    const ancestors = await getMemberAncestors(db, assigneeId);
    const projectLeaders = await getProjectLeadershipIds(db, projectId, assigneeId);
    await notifyRecipients(db, [
      ...parents,
      ...ancestors.map((a) => a.member_id),
      ...projectLeaders,
    ], {
      type: "task_in_review",
      title: "Task ready for review",
      message: `"${taskTitle}" reached its estimated active time and is ready for review.`,
      link: "timesheets-view",
    });
    return;
  }

  if (nextStatus === "done") {
    await notifyRecipients(db, [assigneeId], {
      type: "task_completed",
      title: "Task completed",
      message: `"${taskTitle}" has been approved and marked completed.`,
      link,
    });
    const parents = await getDirectParentIds(db, assigneeId);
    const projectLeaders = await getProjectLeadershipIds(db, projectId, assigneeId);
    await notifyRecipients(db, [...parents, ...projectLeaders], {
      type: "task_completed_mgmt",
      title: "Assignment approved",
      message: `"${taskTitle}" assignment was approved.`,
      link,
    });
    return;
  }

  if (nextStatus === "blocked") {
    const parents = await getDirectParentIds(db, assigneeId);
    const projectLeaders = await getProjectLeadershipIds(db, projectId, assigneeId);
    await notifyRecipients(db, [...parents, ...projectLeaders], {
      type: "task_blocked",
      title: "Assignee blocked",
      message: `${actorName} marked "${taskTitle}" as blocked.`,
      link,
    });
  }
}

export async function getTaskAssignments(db, taskId) {
  const rows = await getTaskAssignmentsPg(taskId);
  return rows.map((row) => normalizeAssignment(row));
}

export async function getTaskParticipation(db, taskId, viewerMemberId, viewerRole, options = {}) {
  const task = await getTaskPg(taskId);
  if (!task) throw new Error("Task not found");

  const assignments = await getTaskAssignments(db, taskId);
  const required = assignments.filter((a) => a.required !== false);
  const participation = computeParticipationStats(required);

  const trackingRows = await getTaskTrackingRowsPg(taskId);
  const trackingByUser = new Map();
  for (const row of trackingRows) {
    trackingByUser.set(row.member_id, {
      startedAt: toIso(row.last_started_at),
      activeSeconds: typeof row.active_seconds === "number" ? row.active_seconds : 0,
    });
  }

  const memberCache = new Map();
  async function memberName(userId) {
    if (memberCache.has(userId)) return memberCache.get(userId);
    const row = await getMemberByIdPg(userId);
    const name = row
      ? `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unknown"
      : "Unknown";
    memberCache.set(userId, name);
    return name;
  }

  const canViewAll = isManagementRole(viewerRole) || options.viewAll === true;
  const visibleAssignments = [];

  for (const assignment of required) {
    const visible = await isAssignmentVisible(db, viewerMemberId, viewerRole, assignment, task);
    if (!visible) continue;

    if (!canViewAll && assignment.userId !== viewerMemberId) continue;

    const tracking = trackingByUser.get(assignment.userId);
    visibleAssignments.push({
      assignmentId: assignment.id,
      userId: assignment.userId,
      employeeName: await memberName(assignment.userId),
      status: assignment.status,
      participationStatus: participationStatusLabel(assignment.status),
      started: isAssignmentStarted(assignment.status),
      startedAt: tracking?.startedAt ?? null,
      activeSeconds: tracking?.activeSeconds ?? 0,
      isSelf: assignment.userId === viewerMemberId,
    });
  }

  const response = {
    taskId,
    taskStatus: task.status ?? "todo",
    ...participation,
    assignments: visibleAssignments,
  };

  if (!canViewAll) {
    const self = visibleAssignments.find((a) => a.isSelf) ?? null;
    return {
      taskId,
      taskStatus: task.status ?? "todo",
      myAssignment: self,
      assignments: self ? [self] : [],
    };
  }

  return response;
}

export async function startTaskForUser(db, { taskId, userId, userName }) {
  const task = await getTaskPg(taskId);
  if (!task) throw new Error("Task not found");

  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  let statusChanged = false;
  let assignmentStatus = assignment.status;

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
    }
  }

  const taskStatus = await recomputeTaskStatus(db, taskId);
  const freshTask = await getTaskPg(taskId);
  const participation = computeParticipationStats(await getTaskAssignments(db, taskId));

  return {
    assignmentStatus,
    taskStatus: freshTask?.status ?? taskStatus ?? "todo",
    statusChanged,
    ...participation,
  };
}

export async function blockTaskForUser(db, { taskId, userId, userName }) {
  const task = await getTaskPg(taskId);
  if (!task) throw new Error("Task not found");

  const assignment = await ensureAssignmentForUser(db, taskId, userId);
  let statusChanged = false;
  let assignmentStatus = assignment.status;

  if (assignmentStatus === "todo" || assignmentStatus === "in_progress") {
    const result = await updateAssignmentStatus(db, assignment.id, "blocked", userId);
    if (result && result.previousStatus !== result.nextStatus) {
      statusChanged = true;
      assignmentStatus = result.nextStatus;
      await notifyAssignmentStatusChange(db, {
        task,
        assigneeId: userId,
        previousStatus: result.previousStatus,
        nextStatus: "blocked",
        actorName: userName || "A team member",
      });
    }
  }

  const taskStatus = await recomputeTaskStatus(db, taskId);
  const freshTask = await getTaskPg(taskId);
  const participation = computeParticipationStats(await getTaskAssignments(db, taskId));

  return {
    assignmentStatus,
    taskStatus: freshTask?.status ?? taskStatus ?? "todo",
    statusChanged,
    ...participation,
  };
}

export async function syncTaskAssignments(db, taskId, assigneeIds = [], options = {}) {
  const task = await getTaskPg(taskId);
  if (!task) throw new Error("Task not found");
  const projectId = task.project_id ?? null;
  const expectedSeconds = estimateAssignmentSeconds(task);
  const now = new Date();

  const ids = [...new Set(assigneeIds.filter(Boolean))];
  if (ids.length === 0) {
    const primary = task.assigned_to ?? task.assignedTo;
    if (primary) ids.push(primary);
  }

  if (ids.length > 0) {
    await validateAssigneeWorkLimits(db, { ...task, id: taskId }, ids, { taskId });
  }

  const existingRows = await getTaskAssignmentsPg(taskId);
  const existingByUser = new Map(existingRows.map((row) => [row.member_id, row]));
  const newlyAssigned = [];

  for (const userId of ids) {
    const existing = existingByUser.get(userId);
    if (existing) {
      await updateAssignmentPg(existing.id, {
        expected_seconds: expectedSeconds,
        project_id: projectId,
        required: true,
      });
      existingByUser.delete(userId);
    } else {
      await upsertAssignmentPg({
        task_id: taskId,
        member_id: userId,
        project_id: projectId,
        status: task.status ?? "todo",
        expected_seconds: expectedSeconds,
        required: true,
        created_at: now,
        updated_at: now,
      });
      newlyAssigned.push(userId);
    }
  }

  if (options.removeUnlisted) {
    for (const [, row] of existingByUser) {
      await deleteAssignmentPg(row.id);
    }
  }

  if (ids.length > 0) {
    const primary = ids[0];
    const currentPrimary = task.assigned_to ?? task.assignedTo ?? null;
    if (primary && primary !== currentPrimary) {
      await updateTaskPg(taskId, { assigned_to: primary });
    }
  }

  await notifyRecipients(db, newlyAssigned, {
    type: "task_assigned",
    title: "New Task Assigned",
    message: `You have been assigned to task: ${task.title || "Unknown"}`,
    link: projectId ? `pm-tasks?project=${projectId}` : "pm-tasks",
  });

  await recomputeTaskStatus(db, taskId);
  return getTaskAssignments(db, taskId);
}

export async function getTaskIdsAssignedToMembers(db, userIds) {
  return getTaskIdsAssignedToMembersPg(userIds);
}

export async function enrichTasksWithAssignees(db, rows) {
  if (!rows.length) return rows;

  const taskIds = rows.map((row) => (typeof row.id === "string" ? row.id : "")).filter(Boolean);
  const assignmentsByTask = new Map();

  const assignmentRows = await getAssignmentsForTasksPg(taskIds);
  for (const data of assignmentRows) {
    const taskId = typeof data.task_id === "string" ? data.task_id : "";
    const userId = typeof data.member_id === "string" ? data.member_id : "";
    if (!taskId || !userId || data.required === false) continue;
    if (!assignmentsByTask.has(taskId)) assignmentsByTask.set(taskId, []);
    assignmentsByTask.get(taskId).push(userId);
  }

  return rows.map((row) => {
    const taskId = typeof row.id === "string" ? row.id : "";
    const assigneeIds = taskId ? [...new Set(assignmentsByTask.get(taskId) ?? [])] : [];
    const primary =
      (typeof row.assigned_to === "string" && row.assigned_to) ||
      (typeof row.assignedTo === "string" && row.assignedTo) ||
      assigneeIds[0] ||
      null;
    return {
      ...row,
      assigned_to: primary,
      assignee_ids: assigneeIds,
      total_assignees: assigneeIds.length > 0 ? assigneeIds.length : row.total_assignees ?? null,
    };
  });
}

export async function ensureAssignmentForUser(db, taskId, userId) {
  const existing = await findAssignmentPg(taskId, userId);
  if (existing) return normalizeAssignment(existing);

  const task = await getTaskPg(taskId);
  if (!task) throw new Error("Task not found");
  const row = await upsertAssignmentPg({
    task_id: taskId,
    member_id: userId,
    project_id: task.project_id ?? null,
    status: "todo",
    expected_seconds: estimateAssignmentSeconds(task),
    required: true,
  });
  return normalizeAssignment(row);
}

export async function migrateTaskAssignments(db, limit = 200) {
  const tasks = await listTasksPg({ limit });
  let created = 0;
  for (const task of tasks) {
    const assignee = task.assigned_to ?? task.assignedTo;
    if (!assignee) continue;
    const existing = await findAssignmentPg(task.id, assignee);
    if (existing) continue;
    await ensureAssignmentForUser(db, task.id, assignee);
    const assignment = await findAssignmentPg(task.id, assignee);
    if (assignment) {
      await updateAssignmentPg(assignment.id, {
        status: task.status ?? "todo",
        expected_seconds: estimateAssignmentSeconds(task),
      });
    }
    created += 1;
  }
  return { migrated: created };
}

export async function updateAssignmentStatus(db, assignmentId, nextStatus, updatedBy, options = {}) {
  const existing = await getAssignmentByIdPg(assignmentId);
  if (!existing) return null;
  const previousStatus = existing.status ?? "todo";
  if (previousStatus === nextStatus) return { previousStatus, nextStatus, assignment: normalizeAssignment(existing) };

  const patch = { status: nextStatus };
  if (nextStatus === "in_review" && !existing.entered_review_at) {
    patch.entered_review_at = new Date();
  }
  if (options.reviewState !== undefined) patch.review_state = options.reviewState;
  if (options.reviewedBy !== undefined) patch.reviewed_by = options.reviewedBy;
  if (options.reviewedAt !== undefined) patch.reviewed_at = options.reviewedAt;
  if (options.reviewNotes !== undefined) patch.review_notes = options.reviewNotes;

  const updated = await updateAssignmentPg(assignmentId, patch);
  return { previousStatus, nextStatus, assignment: normalizeAssignment(updated) };
}

export async function recomputeTaskStatus(db, taskId) {
  const task = await getTaskPg(taskId);
  if (!task) return null;

  const assignmentRows = await getTaskAssignmentsPg(taskId);

  const assignments = assignmentRows
    .map((row) => normalizeAssignment(row))
    .filter((a) => a.required !== false);
  if (assignments.length === 0) return task.status ?? "todo";

  const statuses = assignments.map((a) => a.status);
  const previousStatus = task.status ?? "todo";
  let nextStatus = "todo";

  if (statuses.every((s) => s === "done")) {
    nextStatus = "done";
  } else if (statuses.some((s) => s === "in_review")) {
    nextStatus = "in_review";
  } else if (statuses.some((s) => s === "in_progress")) {
    nextStatus = "in_progress";
  } else if (statuses.every((s) => s === "blocked" || s === "done")) {
    nextStatus = statuses.some((s) => s === "blocked") ? "blocked" : "done";
  } else if (statuses.some((s) => s === "blocked")) {
    nextStatus = "blocked";
  } else if (previousStatus === "blocked") {
    nextStatus = "blocked";
  } else {
    nextStatus = statuses[0] ?? "todo";
  }

  const participation = computeParticipationStats(assignments);
  const patch = {
    status: nextStatus,
    completed: nextStatus === "done",
    total_assignees: participation.totalAssignees,
    started_assignees: participation.startedAssignees,
    not_started_assignees: participation.notStartedAssignees,
    participation_percent: participation.participationPercent,
    all_assignees_started: participation.allAssigneesStarted,
  };

  const unchangedStatus = previousStatus === nextStatus;
  const participationUnchanged =
    task.total_assignees === participation.totalAssignees &&
    task.started_assignees === participation.startedAssignees &&
    task.all_assignees_started === participation.allAssigneesStarted;

  if (unchangedStatus && participationUnchanged) {
    try {
      const { aggregateTaskProgress } = await import("./task-time-tracking.js");
      await aggregateTaskProgress(db, taskId);
    } catch {
      /* non-fatal */
    }
    return nextStatus;
  }

  await updateTaskPg(taskId, patch);
  try {
    const { aggregateTaskProgress } = await import("./task-time-tracking.js");
    await aggregateTaskProgress(db, taskId);
  } catch {
    /* non-fatal */
  }
  return nextStatus;
}

async function getClientProjectIds(db, memberId) {
  const memberRow = await getMemberByIdPg(memberId);
  if (!memberRow) return [];
  const projects = memberRow.projects;
  if (Array.isArray(projects) && projects.length > 0) return projects;

  return listViewerProjectIdsPg(memberId).catch(() => []);
}

async function isAssignmentVisible(db, viewerMemberId, viewerRole, assignment, task) {
  const role = normalizeRole(viewerRole);

  if (isEmployeeRole(viewerRole)) {
    return assignment.userId === viewerMemberId;
  }

  const visibleIds = await getVisibleMemberIds(db, viewerMemberId, viewerRole);
  const isPrivileged = visibleIds === null;

  if (!isPrivileged && !visibleIds.includes(assignment.userId)) {
    return false;
  }

  if (role === "client") {
    const clientProjects = await getClientProjectIds(db, viewerMemberId);
    const projectId = assignment.projectId ?? task?.project_id;
    if (!projectId || !clientProjects.includes(projectId)) return false;
  }

  return true;
}

async function enrichAssignmentRow(db, assignment, trackingByKey, caches) {
  const { taskCache, memberCache, projectCache } = caches;

  async function loadTask(taskId) {
    if (taskCache.has(taskId)) return taskCache.get(taskId);
    const data = await getTaskPg(taskId);
    taskCache.set(taskId, data);
    return data;
  }

  async function loadMember(memberId) {
    if (memberCache.has(memberId)) return memberCache.get(memberId);
    const d = await getMemberByIdPg(memberId);
    if (!d) {
      memberCache.set(memberId, { name: "Unknown" });
      return memberCache.get(memberId);
    }
    const name = `${d.first_name || ""} ${d.last_name || ""}`.trim() || "Unknown";
    memberCache.set(memberId, { name });
    return memberCache.get(memberId);
  }

  async function loadProject(projectId) {
    if (!projectId) return { name: "" };
    if (projectCache.has(projectId)) return projectCache.get(projectId);
    const project = await getProjectPg(projectId);
    const name = project?.name ?? "";
    projectCache.set(projectId, { name });
    return projectCache.get(projectId);
  }

  const task = await loadTask(assignment.taskId);
  if (!task) return null;

  const member = await loadMember(assignment.userId);
  const projectId = assignment.projectId ?? task.project_id;
  const project = await loadProject(projectId);
  const tracking = trackingByKey.get(`${assignment.taskId}:${assignment.userId}`);
  const loggedSeconds = tracking?.activeSeconds ?? 0;
  const expectedSeconds = assignment.expectedSeconds ?? estimateAssignmentSeconds(task);

  return {
    assignmentId: assignment.id,
    taskId: assignment.taskId,
    userId: assignment.userId,
    employeeName: member.name,
    projectId,
    projectName: project.name,
    taskTitle: task.title ?? "",
    taskName: task.title ?? "",
    priority: task.priority ?? "medium",
    assignmentStatus: assignment.status,
    participationStatus: participationStatusLabel(assignment.status),
    taskStatus: task.status ?? "todo",
    expectedSeconds,
    loggedSeconds,
    activeSeconds: loggedSeconds,
    idleSeconds: tracking?.idleSeconds ?? 0,
    progressPercent:
      expectedSeconds && expectedSeconds > 0
        ? Math.min(100, Math.round((loggedSeconds / expectedSeconds) * 100))
        : null,
    enteredReviewAt: assignment.enteredReviewAt,
    lastActivityAt: tracking?.lastActivityAt ?? null,
    startedAt: tracking?.startedAt ?? null,
    reviewNotes: assignment.reviewNotes,
    isPriorityMonitor: HIGH_PRIORITIES.has(String(task.priority ?? "").toLowerCase()),
    needsReview: assignment.status === "in_review",
    totalAssignees: typeof task.total_assignees === "number" ? task.total_assignees : null,
    startedAssignees: typeof task.started_assignees === "number" ? task.started_assignees : null,
    notStartedAssignees: typeof task.not_started_assignees === "number" ? task.not_started_assignees : null,
    participationPercent: typeof task.participation_percent === "number" ? task.participation_percent : null,
    allAssigneesStarted: task.all_assignees_started === true,
  };
}

export async function getReviewQueue(db, viewerMemberId, viewerRole, filters = {}) {
  if (!isReviewCenterRole(viewerRole) && !isEmployeeRole(viewerRole)) {
    throw new Error("Only review center roles can access the review queue");
  }

  const assignmentRows = await listAllAssignmentsPg();
  const trackingRows = await getAllTrackingRowsPg();

  const trackingByKey = new Map();
  for (const row of trackingRows) {
    trackingByKey.set(`${row.task_id}:${row.member_id}`, {
      activeSeconds: typeof row.active_seconds === "number" ? row.active_seconds : 0,
      idleSeconds: typeof row.idle_seconds === "number" ? row.idle_seconds : 0,
      lastActivityAt: toIso(row.last_activity_at),
      startedAt: toIso(row.last_started_at),
    });
  }

  const caches = {
    taskCache: new Map(),
    memberCache: new Map(),
    projectCache: new Map(),
  };

  const needsReview = [];
  const priorityMonitor = [];

  for (const row of assignmentRows) {
    const assignment = normalizeAssignment(row);
    const task = caches.taskCache.has(assignment.taskId)
      ? caches.taskCache.get(assignment.taskId)
      : await getTaskPg(assignment.taskId);
    caches.taskCache.set(assignment.taskId, task);
    if (!task) continue;

    const visible = await isAssignmentVisible(db, viewerMemberId, viewerRole, assignment, task);
    if (!visible) continue;

    if (filters.projectId) {
      const pid = assignment.projectId ?? task.project_id;
      if (pid !== filters.projectId) continue;
    }
    if (filters.memberId && assignment.userId !== filters.memberId) continue;
    if (filters.priority) {
      const p = String(task.priority ?? "").toLowerCase();
      if (p !== filters.priority.toLowerCase()) continue;
    }

    const enrichedRow = await enrichAssignmentRow(db, assignment, trackingByKey, caches);
    if (!enrichedRow) continue;

    if (assignment.status === "in_review") {
      if (!filters.status || filters.status === "in_review") {
        needsReview.push(enrichedRow);
      }
    }

    const priority = String(task.priority ?? "").toLowerCase();
    if (HIGH_PRIORITIES.has(priority) && assignment.status !== "in_review") {
      priorityMonitor.push(enrichedRow);
    }
  }

  const sortByRecency = (a, b) => {
    const aMs = a.enteredReviewAt
      ? Date.parse(a.enteredReviewAt)
      : a.lastActivityAt
        ? Date.parse(a.lastActivityAt)
        : 0;
    const bMs = b.enteredReviewAt
      ? Date.parse(b.enteredReviewAt)
      : b.lastActivityAt
        ? Date.parse(b.lastActivityAt)
        : 0;
    return bMs - aMs;
  };

  needsReview.sort(sortByRecency);
  priorityMonitor.sort((a, b) => {
    const prioRank = (p) => (p === "urgent" ? 2 : p === "high" ? 1 : 0);
    const diff = prioRank(b.priority) - prioRank(a.priority);
    if (diff !== 0) return diff;
    return sortByRecency(a, b);
  });

  return { needsReview, priorityMonitor };
}

export async function reviewAssignment(db, { assignmentId, reviewerId, reviewerName, decision, notes }) {
  const reviewerRole = await resolveMemberRoleName(db, reviewerId);
  if (!isManagementRole(reviewerRole)) {
    throw new Error("Only management roles can review assignments");
  }

  const assignmentRow = await getAssignmentByIdPg(assignmentId);
  if (!assignmentRow) throw new Error("Assignment not found");

  const assignment = normalizeAssignment(assignmentRow);
  const task = await getTaskPg(assignment.taskId);
  if (!task) throw new Error("Task not found");

  const visible = await isAssignmentVisible(db, reviewerId, reviewerRole, assignment, task);
  if (!visible) throw new Error("Assignment is outside your authorized scope");

  if (assignment.status !== "in_review") {
    throw new Error("Assignment is not in review");
  }

  const now = new Date();
  if (decision === "approve") {
    const result = await updateAssignmentStatus(db, assignmentId, "done", reviewerId, {
      reviewState: "approved",
      reviewedBy: reviewerId,
      reviewedAt: now,
      reviewNotes: notes ?? "",
    });
    await recomputeTaskStatus(db, assignment.taskId);
    await notifyAssignmentStatusChange(db, {
      task,
      assigneeId: assignment.userId,
      previousStatus: "in_review",
      nextStatus: "done",
      actorName: reviewerName || "Management",
    });
    await updateTrackingFieldsPg(assignment.taskId, assignment.userId, { review_notes: notes ?? "" });
    const freshTask = await getTaskPg(assignment.taskId);
    return {
      assignmentStatus: "done",
      taskStatus: freshTask?.status ?? "done",
      assignment: result?.assignment,
    };
  }

  if (decision === "reject") {
    const result = await updateAssignmentStatus(db, assignmentId, "in_progress", reviewerId, {
      reviewState: "rejected",
      reviewedBy: reviewerId,
      reviewedAt: now,
      reviewNotes: notes ?? "",
    });
    await recomputeTaskStatus(db, assignment.taskId);
    await notifyAssignmentStatusChange(db, {
      task,
      assigneeId: assignment.userId,
      previousStatus: "in_review",
      nextStatus: "in_progress",
      actorName: reviewerName || "Management",
    });
    await updateTrackingFieldsPg(assignment.taskId, assignment.userId, { review_notes: notes ?? "" });
    const freshTask = await getTaskPg(assignment.taskId);
    return {
      assignmentStatus: "in_progress",
      taskStatus: freshTask?.status ?? "in_progress",
      assignment: result?.assignment,
    };
  }

  throw new Error("decision must be approve or reject");
}

export { normalizeAssignment, notifyAssignmentStatusChange };
