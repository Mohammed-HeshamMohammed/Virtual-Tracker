import crypto from "node:crypto";
import { validateAssigneeWorkLimits } from "./task-workload-validation.js";
import { COLLECTIONS } from "../../lib/firestore/collections.js";
import { taskChildCollectionRef } from "../../lib/firestore/task-subcollections.js";
import { createNotification } from "../notifications/service.js";
import { getMemberAncestors, getVisibleMemberIds } from "../member-relationships/service.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";

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
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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

function parseDate(value) {
  const iso = toIso(value);
  if (!iso) return null;
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Count Mon–Fri between start and due (inclusive). */
export function countWorkingDaysBetween(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) return null;
  if (end.getTime() < start.getTime()) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function estimateAssignmentSeconds(taskData) {
  if (!taskData) return null;
  const hoursPerDay = Number(taskData.duration_hours_per_day ?? taskData.durationHoursPerDay ?? 0);
  const overtimePerDay = Number(taskData.overtime_hours_per_day ?? taskData.overtimeHoursPerDay ?? 0);
  const hoursTotal = hoursPerDay + overtimePerDay;
  if (hoursTotal <= 0) return null;

  let workingDays = countWorkingDaysBetween(
    taskData.start_date ?? taskData.startDate,
    taskData.due_date ?? taskData.dueDate,
  );
  if (workingDays == null || workingDays <= 0) {
    workingDays = Number(taskData.working_days ?? taskData.workingDays ?? taskData.duration_days ?? taskData.durationDays ?? 0);
  }
  if (workingDays <= 0) workingDays = 1;

  return Math.floor(workingDays * hoursTotal * 3600);
}

/** @deprecated Use estimateAssignmentSeconds */
export function estimateTaskDurationSeconds(taskData) {
  return estimateAssignmentSeconds(taskData);
}

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
    userId: d.user_id,
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

async function findAssignmentDoc(db, taskId, userId) {
  const snap = await db
    .collection("task_assignments")
    .where("task_id", "==", taskId)
    .where("user_id", "==", userId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

async function getDirectParentIds(db, memberId) {
  const snap = await db
    .collection("member_relationships")
    .where("child_member_id", "==", memberId)
    .limit(20)
    .get();
  return snap.docs.map((d) => d.data()?.parent_member_id).filter(Boolean);
}

async function getProjectMemberIds(db, projectId) {
  if (!projectId) return [];
  const snap = await db
    .collection("project_members")
    .where("project_id", "==", projectId)
    .limit(200)
    .get()
    .catch(() => ({ docs: [] }));
  return snap.docs?.map((d) => d.data()?.member_id).filter(Boolean) ?? [];
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

async function notifyAssignmentStatusChange(db, { task, assigneeId, previousStatus, nextStatus, actorName }) {
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
    await createNotification(db, {
      recipient_id: assigneeId,
      type: "task_rejected",
      title: "Assignment rejected",
      message: `"${taskTitle}" was rejected and marked blocked.`,
      link: "pm-tasks",
    }).catch(() => null);
  }
}

export async function getTaskAssignments(db, taskId) {
  const snap = await db.collection("task_assignments").where("task_id", "==", taskId).limit(50).get();
  return snap.docs.map((doc) => normalizeAssignment(doc));
}

export async function getTaskParticipation(db, taskId, viewerMemberId, viewerRole, options = {}) {
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) throw new Error("Task not found");
  const task = taskSnap.data();

  const assignments = await getTaskAssignments(db, taskId);
  const required = assignments.filter((a) => a.required !== false);
  const participation = computeParticipationStats(required);

  const trackingSnap = await taskChildCollectionRef(db, taskId, "task-time-tracking").limit(50).get();
  const trackingByUser = new Map();
  for (const doc of trackingSnap.docs) {
    const d = doc.data();
    trackingByUser.set(d.user_id, {
      startedAt: toIso(d.started_at),
      activeSeconds: typeof d.active_seconds === "number" ? d.active_seconds : 0,
    });
  }

  const memberCache = new Map();
  async function memberName(userId) {
    if (memberCache.has(userId)) return memberCache.get(userId);
    const snap = await db.collection("members").doc(userId).get();
    const name = snap.exists
      ? `${snap.data()?.first_name || ""} ${snap.data()?.last_name || ""}`.trim() || "Unknown"
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
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) throw new Error("Task not found");
  const task = taskSnap.data();

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
  const freshTask = await db.collection("tasks").doc(taskId).get();
  const participation = computeParticipationStats(await getTaskAssignments(db, taskId));

  return {
    assignmentStatus,
    taskStatus: freshTask.data()?.status ?? taskStatus ?? "todo",
    statusChanged,
    ...participation,
  };
}

export async function syncTaskAssignments(db, taskId, assigneeIds = [], options = {}) {
  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) throw new Error("Task not found");
  const task = taskSnap.data();
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

  const existingSnap = await db.collection("task_assignments").where("task_id", "==", taskId).limit(50).get();
  const existingByUser = new Map(existingSnap.docs.map((d) => [d.data().user_id, d]));

  for (const userId of ids) {
    const existing = existingByUser.get(userId);
    if (existing) {
      await existing.ref.update({
        expected_seconds: expectedSeconds,
        project_id: projectId,
        required: true,
        updated_at: now,
      });
      existingByUser.delete(userId);
    } else {
      const id = crypto.randomUUID();
      await db.collection("task_assignments").doc(id).set({
        id,
        task_id: taskId,
        user_id: userId,
        project_id: projectId,
        status: task.status ?? "todo",
        expected_seconds: expectedSeconds,
        required: true,
        review_state: null,
        reviewed_by: null,
        reviewed_at: null,
        review_notes: "",
        entered_review_at: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  if (options.removeUnlisted) {
    for (const [, doc] of existingByUser) {
      await doc.ref.delete();
    }
  }

  if (ids.length > 0) {
    const primary = ids[0];
    const currentPrimary = task.assigned_to ?? task.assignedTo ?? null;
    if (primary && primary !== currentPrimary) {
      await db.collection("tasks").doc(taskId).update({
        assigned_to: primary,
        updated_at: now,
      });
    }
  }

  await recomputeTaskStatus(db, taskId);
  return getTaskAssignments(db, taskId);
}

/** Task IDs assigned to any of these members. */
export async function getTaskIdsAssignedToMembers(db, userIds) {
  const taskIds = new Set();
  const unique = [...new Set(userIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await db.collection("task_assignments").where("user_id", "in", chunk).limit(200).get();
    for (const doc of snap.docs) {
      const taskId = doc.data()?.task_id;
      if (typeof taskId === "string" && taskId) taskIds.add(taskId);
    }
  }
  return taskIds;
}

/** Attach assignee_ids + primary assigned_to on task rows. */
export async function enrichTasksWithAssignees(db, rows) {
  if (!rows.length) return rows;

  const taskIds = rows.map((row) => (typeof row.id === "string" ? row.id : "")).filter(Boolean);
  const assignmentsByTask = new Map();

  for (let i = 0; i < taskIds.length; i += 30) {
    const chunk = taskIds.slice(i, i + 30);
    const snap = await db.collection("task_assignments").where("task_id", "in", chunk).limit(500).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const taskId = typeof data.task_id === "string" ? data.task_id : "";
      const userId = typeof data.user_id === "string" ? data.user_id : "";
      if (!taskId || !userId || data.required === false) continue;
      if (!assignmentsByTask.has(taskId)) assignmentsByTask.set(taskId, []);
      assignmentsByTask.get(taskId).push(userId);
    }
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
  const existing = await findAssignmentDoc(db, taskId, userId);
  if (existing) return normalizeAssignment(existing);

  const taskSnap = await db.collection("tasks").doc(taskId).get();
  if (!taskSnap.exists) throw new Error("Task not found");
  const task = taskSnap.data();
  const now = new Date();
  const id = crypto.randomUUID();
  const row = {
    id,
    task_id: taskId,
    user_id: userId,
    project_id: task.project_id ?? null,
    status: "todo",
    expected_seconds: estimateAssignmentSeconds(task),
    required: true,
    review_state: null,
    reviewed_by: null,
    reviewed_at: null,
    review_notes: "",
    entered_review_at: null,
    created_at: now,
    updated_at: now,
  };
  await db.collection("task_assignments").doc(id).set(row);
  return normalizeAssignment({ id, data: () => row });
}

export async function migrateTaskAssignments(db, limit = 200) {
  const snap = await db.collection("tasks").limit(limit).get();
  let created = 0;
  for (const doc of snap.docs) {
    const task = doc.data();
    const assignee = task.assigned_to ?? task.assignedTo;
    if (!assignee) continue;
    const existing = await findAssignmentDoc(db, doc.id, assignee);
    if (existing) continue;
    await ensureAssignmentForUser(db, doc.id, assignee);
    const assignment = await findAssignmentDoc(db, doc.id, assignee);
    if (assignment) {
      await assignment.ref.update({
        status: task.status ?? "todo",
        expected_seconds: estimateAssignmentSeconds(task),
      });
    }
    created += 1;
  }
  return { migrated: created };
}

export async function updateAssignmentStatus(db, assignmentId, nextStatus, updatedBy, options = {}) {
  const ref = db.collection("task_assignments").doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const previousStatus = snap.data()?.status ?? "todo";
  if (previousStatus === nextStatus) return { previousStatus, nextStatus, assignment: normalizeAssignment(snap) };

  const now = new Date();
  const patch = {
    status: nextStatus,
    updated_at: now,
  };
  if (nextStatus === "in_review" && !snap.data()?.entered_review_at) {
    patch.entered_review_at = now;
  }
  if (options.reviewState !== undefined) patch.review_state = options.reviewState;
  if (options.reviewedBy !== undefined) patch.reviewed_by = options.reviewedBy;
  if (options.reviewedAt !== undefined) patch.reviewed_at = options.reviewedAt;
  if (options.reviewNotes !== undefined) patch.review_notes = options.reviewNotes;

  await ref.update(patch);
  const updated = await ref.get();
  return { previousStatus, nextStatus, assignment: normalizeAssignment(updated) };
}

export async function recomputeTaskStatus(db, taskId) {
  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) return null;

  const assignmentsSnap = await db
    .collection("task_assignments")
    .where("task_id", "==", taskId)
    .limit(50)
    .get();

  const assignments = assignmentsSnap.docs
    .map((d) => normalizeAssignment(d))
    .filter((a) => a.required !== false);
  if (assignments.length === 0) return taskSnap.data()?.status ?? "todo";

  const statuses = assignments.map((a) => a.status);
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
    nextStatus = "in_progress";
  } else {
    nextStatus = statuses[0] ?? "todo";
  }

  const previousStatus = taskSnap.data()?.status ?? "todo";
  const participation = computeParticipationStats(assignments);
  const now = new Date();
  const patch = {
    status: nextStatus,
    updated_at: now,
    completed: nextStatus === "done",
    total_assignees: participation.totalAssignees,
    started_assignees: participation.startedAssignees,
    not_started_assignees: participation.notStartedAssignees,
    participation_percent: participation.participationPercent,
    all_assignees_started: participation.allAssigneesStarted,
  };

  const unchangedStatus = previousStatus === nextStatus;
  const existing = taskSnap.data() ?? {};
  const participationUnchanged =
    existing.total_assignees === participation.totalAssignees &&
    existing.started_assignees === participation.startedAssignees &&
    existing.all_assignees_started === participation.allAssigneesStarted;

  if (unchangedStatus && participationUnchanged) {
    try {
      const { aggregateTaskProgress } = await import("./task-time-tracking.js");
      await aggregateTaskProgress(db, taskId);
    } catch {
      /* non-fatal */
    }
    return nextStatus;
  }

  await taskRef.update(patch);
  try {
    const { aggregateTaskProgress } = await import("./task-time-tracking.js");
    await aggregateTaskProgress(db, taskId);
  } catch {
    /* non-fatal */
  }
  return nextStatus;
}

async function getClientProjectIds(db, memberId) {
  const memberDoc = await db.collection("members").doc(memberId).get();
  if (!memberDoc.exists) return [];
  const projects = memberDoc.data()?.projects;
  if (Array.isArray(projects) && projects.length > 0) return projects;

  const pmSnap = await db
    .collection("project_members")
    .where("member_id", "==", memberId)
    .limit(100)
    .get()
    .catch(() => ({ docs: [] }));
  return pmSnap.docs?.map((d) => d.data()?.project_id).filter(Boolean) ?? [];
}

async function isAssignmentVisible(db, viewerMemberId, viewerRole, assignment, task) {
  const role = normalizeRole(viewerRole);
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
    const snap = await db.collection("tasks").doc(taskId).get();
    const data = snap.exists ? snap.data() : null;
    taskCache.set(taskId, data);
    return data;
  }

  async function loadMember(memberId) {
    if (memberCache.has(memberId)) return memberCache.get(memberId);
    const snap = await db.collection("members").doc(memberId).get();
    if (!snap.exists) {
      memberCache.set(memberId, { name: "Unknown" });
      return memberCache.get(memberId);
    }
    const d = snap.data();
    const name = `${d.first_name || ""} ${d.last_name || ""}`.trim() || "Unknown";
    memberCache.set(memberId, { name });
    return memberCache.get(memberId);
  }

  async function loadProject(projectId) {
    if (!projectId) return { name: "" };
    if (projectCache.has(projectId)) return projectCache.get(projectId);
    const snap = await db.collection(COLLECTIONS.projects).doc(projectId).get();
    const name = snap.exists ? snap.data()?.name ?? "" : "";
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
  if (!isReviewCenterRole(viewerRole)) {
    throw new Error("Only review center roles can access the review queue");
  }

  const assignmentsSnap = await db.collection("task_assignments").limit(500).get();
  const trackingSnap = await db.collectionGroup("time_tracking").limit(500).get();

  const trackingByKey = new Map();
  for (const doc of trackingSnap.docs) {
    const d = doc.data();
    const taskId = d.task_id ?? doc.ref.parent?.parent?.id ?? "";
    trackingByKey.set(`${taskId}:${d.user_id}`, {
      activeSeconds: typeof d.active_seconds === "number" ? d.active_seconds : 0,
      idleSeconds: typeof d.idle_seconds === "number" ? d.idle_seconds : 0,
      lastActivityAt: toIso(d.last_activity_at),
      startedAt: toIso(d.started_at),
    });
  }

  const caches = {
    taskCache: new Map(),
    memberCache: new Map(),
    projectCache: new Map(),
  };

  const needsReview = [];
  const priorityMonitor = [];

  for (const doc of assignmentsSnap.docs) {
    const assignment = normalizeAssignment(doc);
    const task = caches.taskCache.has(assignment.taskId)
      ? caches.taskCache.get(assignment.taskId)
      : (await db.collection("tasks").doc(assignment.taskId).get()).data();
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

    const row = await enrichAssignmentRow(db, assignment, trackingByKey, caches);
    if (!row) continue;

    if (assignment.status === "in_review") {
      if (!filters.status || filters.status === "in_review") {
        needsReview.push(row);
      }
    }

    const priority = String(task.priority ?? "").toLowerCase();
    if (HIGH_PRIORITIES.has(priority) && assignment.status !== "in_review") {
      priorityMonitor.push(row);
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

  const assignmentRef = db.collection("task_assignments").doc(assignmentId);
  const assignmentSnap = await assignmentRef.get();
  if (!assignmentSnap.exists) throw new Error("Assignment not found");

  const assignment = normalizeAssignment(assignmentSnap);
  const taskSnap = await db.collection("tasks").doc(assignment.taskId).get();
  if (!taskSnap.exists) throw new Error("Task not found");
  const task = taskSnap.data();

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
    const trackingDoc = await taskChildCollectionRef(db, assignment.taskId, "task-time-tracking")
      .where("user_id", "==", assignment.userId)
      .limit(1)
      .get();
    if (!trackingDoc.empty) {
      await trackingDoc.docs[0].ref.update({ review_notes: notes ?? "", updated_at: now });
    }
    const freshTask = await db.collection("tasks").doc(assignment.taskId).get();
    return {
      assignmentStatus: "done",
      taskStatus: freshTask.data()?.status ?? "done",
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
    const trackingDoc = await taskChildCollectionRef(db, assignment.taskId, "task-time-tracking")
      .where("user_id", "==", assignment.userId)
      .limit(1)
      .get();
    if (!trackingDoc.empty) {
      await trackingDoc.docs[0].ref.update({
        review_notes: notes ?? "",
        updated_at: now,
      });
    }
    const freshTask = await db.collection("tasks").doc(assignment.taskId).get();
    return {
      assignmentStatus: "in_progress",
      taskStatus: freshTask.data()?.status ?? "in_progress",
      assignment: result?.assignment,
    };
  }

  throw new Error("decision must be approve or reject");
}

export { normalizeAssignment, findAssignmentDoc, notifyAssignmentStatusChange };
