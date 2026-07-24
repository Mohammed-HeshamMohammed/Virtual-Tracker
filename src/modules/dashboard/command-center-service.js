// Command Center aggregates, scoped by viewer role.

import {
  buildMemberMetaMap,
  getProjectScopedMemberIds,
  resolveActivityFeedScope,
  resolveMemberRoleName,
} from "../activity/activity-scope.js";
import { fetchPgScreenshots } from "../../lib/postgres/activity-events-postgres.service.js";
import { loadDashboardBase, pseudoDocsFromSerialized } from "./dashboard-base-loader.js";
import {
  budgetSpent,
  buildTrendPaths,
  calculateHealth,
  getMemberProjectIds,
  getRollingWeekDays,
  normalizeRole,
  num,
  str,
  timestampMs,
  toIso,
} from "./dashboard-utils.js";

const PROJECT_COLORS = 10;

function taskRowFromDoc(doc, assigneeNames) {
  const row = doc.data() || {};
  const projectId = str(row, "project_id", "projectId");
  const assigneeId = str(row, "assigned_to", "assignedTo") || null;
  const status = str(row, "status") || "todo";
  return {
    id: doc.id,
    projectId,
    title: str(row, "title") || "Untitled",
    status,
    priority: str(row, "priority") || "medium",
    assigneeId,
    assigneeName: assigneeId ? assigneeNames.get(assigneeId) || "Team member" : null,
    updatedMs: timestampMs(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt),
  };
}

function buildWeeklyTrend(tasks, projectId) {
  const days = getRollingWeekDays();
  const scoped = projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;

  return days.map((day) => {
    const dayTasks = scoped.filter((task) => task.updatedMs >= day.startMs && task.updatedMs <= day.endMs);
    const active = dayTasks.filter((task) => ["in_progress", "in_review", "done"].includes(task.status)).length;
    const idle = dayTasks.filter((task) => ["todo", "blocked"].includes(task.status)).length;
    return {
      key: day.key,
      label: day.label,
      active,
      idle,
      tasks: dayTasks.slice(0, 12).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        assigneeId: task.assigneeId,
        assigneeName: task.assigneeName,
      })),
    };
  });
}

function buildUtilization(tasks, projectId) {
  const scoped = projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;
  const byMember = new Map();

  for (const task of scoped) {
    if (!task.assigneeId) continue;
    if (!byMember.has(task.assigneeId)) {
      byMember.set(task.assigneeId, { active: 0, total: 0, name: task.assigneeName || "Member" });
    }
    const row = byMember.get(task.assigneeId);
    row.total += 1;
    if (task.status === "in_progress" || task.status === "in_review") row.active += 1;
  }

  let optimal = 0;
  let over = 0;
  let under = 0;
  let pctSum = 0;
  let count = 0;

  for (const row of byMember.values()) {
    count += 1;
    const load = row.active;
    pctSum += Math.min(100, Math.round((load / 3) * 100));
    if (load >= 4) over += 1;
    else if (load >= 1) optimal += 1;
    else under += 1;
  }

  const utilizationPercent = count ? Math.round(pctSum / count) : 0;
  const utilizationOffset = Math.max(20, 251.2 - (utilizationPercent / 100) * 251.2);
  return {
    utilizationPercent,
    utilizationOffset,
    utilizationMembers: { optimal, over, under },
  };
}

function buildHealthMilestones(tasks, projectId, fallbackName, fallbackHealth) {
  const scoped = tasks.filter((task) => task.projectId === projectId).slice(0, 4);
  if (!scoped.length) {
    const percent =
      fallbackHealth === "on_track" ? 85 : fallbackHealth === "at_risk" ? 45 : 15;
    return [{ name: fallbackName, percent, health: fallbackHealth }];
  }
  return scoped.map((task) => {
    let health = "at_risk";
    let percent = 20;
    if (task.status === "done") {
      health = "on_track";
      percent = 100;
    } else if (task.status === "in_review") {
      health = "on_track";
      percent = 80;
    } else if (task.status === "in_progress") {
      health = "at_risk";
      percent = 55;
    } else if (task.status === "blocked") {
      health = "stalled";
      percent = 10;
    }
    return { name: task.title, percent, health };
  });
}

function buildStats(projectRow, tasks, projectId, activityPanel) {
  const scoped = projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;
  const done = scoped.filter((task) => task.status === "done").length;
  const total = scoped.length;
  const completion = total > 0 ? Math.round((done / total) * 100) : 0;
  const budgetPct =
    projectRow?.budgetTotal > 0
      ? Math.min(100, Math.round((projectRow.budgetSpent / projectRow.budgetTotal) * 100))
      : 0;

  const activeAssignees = new Set(
    scoped
      .filter((task) => task.status === "in_progress" || task.status === "in_review")
      .map((task) => task.assigneeId)
      .filter(Boolean),
  );

  return {
    timeWorked: formatDurationHours(scoped.filter((task) => task.status !== "todo").length * 2),
    activeMembers: String(Math.max(activeAssignees.size, activityPanel?.inProgress ?? 0, 1)),
    totalMembers: String(Math.max(projectRow?.members ?? 1, 1)),
    budgetPercent: budgetPct,
    budgetLabel: projectRow?.budgetTotal > 0 ? "Budget Used" : "No Budget",
    activityPercent: completion,
    activityBadge:
      completion >= 85 ? "PEAK" : completion >= 70 ? "HIGH" : completion >= 50 ? "GOOD" : completion >= 30 ? "LOW" : "IDLE",
  };
}

function formatDurationHours(taskUnits) {
  const hours = Math.max(0, taskUnits);
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 */
export async function getCommandCenterPayload(db, viewerMemberId) {
  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);
  const isOwner = roleKey === "owner";
  const allowedProjectIds = isOwner ? null : await getMemberProjectIds(db, viewerMemberId);

  const base = await loadDashboardBase(db);
  const projectsSnap = { docs: pseudoDocsFromSerialized(base.projects) };
  const budgetsSnap = { docs: pseudoDocsFromSerialized(base.budgets) };
  const projectMembersSnap = { docs: pseudoDocsFromSerialized(base.projectMembers) };
  const tasksSnap = { docs: pseudoDocsFromSerialized(base.tasks) };

  const budgetByProject = new Map();
  for (const doc of budgetsSnap.docs) {
    const row = doc.data() || {};
    const pid = str(row, "project_id", "projectId");
    if (pid && !budgetByProject.has(pid)) budgetByProject.set(pid, row);
  }

  const memberCountByProject = new Map();
  for (const doc of projectMembersSnap.docs) {
    const row = doc.data() || {};
    const pid = str(row, "project_id", "projectId");
    if (!pid) continue;
    memberCountByProject.set(pid, (memberCountByProject.get(pid) ?? 0) + 1);
  }

  const assigneeIds = new Set();
  for (const doc of tasksSnap.docs) {
    const row = doc.data() || {};
    const aid = str(row, "assigned_to", "assignedTo");
    if (aid) assigneeIds.add(aid);
  }

  const assigneeNames = new Map();
  if (assigneeIds.size > 0) {
    const meta = await buildMemberMetaMap(db, [...assigneeIds]);
    for (const [id, m] of meta.entries()) assigneeNames.set(id, m.name);
  }

  const allTasks = tasksSnap.docs.map((doc) => taskRowFromDoc(doc, assigneeNames));
  const tasksByProject = new Map();
  for (const task of allTasks) {
    if (!task.projectId) continue;
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, []);
    tasksByProject.get(task.projectId).push(task);
  }

  const projectRows = [];
  let colorIndex = 0;
  for (const doc of projectsSnap.docs) {
    if (allowedProjectIds !== null && !allowedProjectIds.has(doc.id)) continue;
    const row = doc.data() || {};
    const status = (str(row, "status") || "active").toLowerCase();
    if (status === "archived") continue;

    const projectTasks = tasksByProject.get(doc.id) ?? [];
    const health = calculateHealth(
      status,
      projectTasks.map((task) => ({ status: task.status })),
    );
    const budgetRow = budgetByProject.get(doc.id);
    const budgetTotal = budgetRow ? num(budgetRow, "cost") : 0;
    const spent = budgetRow ? budgetSpent(budgetTotal, budgetRow) : 0;
    const members = memberCountByProject.get(doc.id) ?? 0;
    const inProgress = projectTasks.filter((task) => task.status === "in_progress").length;

    projectRows.push({
      id: doc.id,
      name: str(row, "name") || "Untitled project",
      colorIndex: colorIndex % PROJECT_COLORS,
      health,
      members: members > 0 ? members : 1,
      budgetTotal,
      budgetSpent: spent,
      done: projectTasks.filter((task) => task.status === "done").length,
      total: projectTasks.length,
      inProgress,
    });
    colorIndex += 1;
  }

  const allowedProjectIdList =
    allowedProjectIds === null ? null : [...allowedProjectIds].filter((id) => projectRows.some((row) => row.id === id));
  const scopedTasks =
    allowedProjectIdList === null
      ? allTasks
      : allTasks.filter((task) => allowedProjectIdList.includes(task.projectId));

  const scope = await resolveActivityFeedScope(db, viewerMemberId, { memberId: "all", projectScopeOnly: !isOwner });
  let activityMemberIds = scope.targetMemberIds;
  if (!isOwner && allowedProjectIdList?.length) {
    const projectMemberIds = await getProjectScopedMemberIds(db, viewerMemberId);
    activityMemberIds =
      activityMemberIds === null
        ? [...projectMemberIds]
        : activityMemberIds.filter((id) => projectMemberIds.has(id));
  }

  const screenshotRows = await fetchPgScreenshots(activityMemberIds, null, 40);
  const rowMemberIds = [...new Set(screenshotRows.map((row) => String(row.member_id ?? "")).filter(Boolean))];
  const rowMemberMeta = rowMemberIds.length > 0 ? await buildMemberMetaMap(db, rowMemberIds) : new Map();
  const projectNameById = new Map(projectRows.map((row) => [row.id, row.name]));

  const globalFeed = screenshotRows.slice(0, 2).map((d) => {
    const meta = rowMemberMeta.get(String(d.member_id ?? "")) || { name: "Unknown", initials: "??" };
    const captured = toIso(d.captured_at);
    return {
      person: meta.name,
      avatar: meta.initials,
      action: "captured a screenshot",
      project: "Active session",
      time: relativeTime(captured || new Date().toISOString()),
      activityBadge: `${Math.round(d.activity_level ?? 0)}% Activity`,
      type: "screenshot",
    };
  });

  const doneTaskFeed = scopedTasks
    .filter((task) => task.status === "done")
    .sort((a, b) => b.updatedMs - a.updatedMs)
    .slice(0, 4)
    .map((task) => ({
      person: task.assigneeName || "Team member",
      avatar: "✓",
      action: "completed task:",
      task: task.title,
      project: projectNameById.get(task.projectId) || "Project",
      time: relativeTime(new Date(task.updatedMs).toISOString()),
      type: "task",
    }));

  const globalActivityFeed = [...globalFeed, ...doneTaskFeed].slice(0, 8);

  function mapProjectPayload(projectRow, projectId) {
    const weeklyTrend = buildWeeklyTrend(scopedTasks, projectId);
    const activeSeries = weeklyTrend.map((day) => day.active);
    const { chartPath, chartFill } = buildTrendPaths(activeSeries);
    const utilization = buildUtilization(scopedTasks, projectId);
    const activityPanel = projectId
      ? { inProgress: projectRows.find((row) => row.id === projectId)?.inProgress ?? 0 }
      : { inProgress: projectRows.reduce((sum, row) => sum + row.inProgress, 0) };

    const aggregateRow = projectId
      ? projectRows.find((row) => row.id === projectId)
      : {
          members: projectRows.reduce((sum, row) => sum + row.members, 0),
          budgetTotal: projectRows.reduce((sum, row) => sum + row.budgetTotal, 0),
          budgetSpent: projectRows.reduce((sum, row) => sum + row.budgetSpent, 0),
          done: projectRows.reduce((sum, row) => sum + row.done, 0),
          total: projectRows.reduce((sum, row) => sum + row.total, 0),
          health: "on_track",
        };

    const health = projectId
      ? buildHealthMilestones(
          scopedTasks,
          projectId,
          aggregateRow?.name || "Project",
          aggregateRow?.health || "on_track",
        )
      : projectRows.slice(0, 4).map((row) => ({
          name: row.name,
          percent: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
          health: row.health,
        }));

    return {
      id: projectId ?? "all",
      name: projectId ? aggregateRow?.name || "Project" : isOwner ? "All Projects" : "All My Projects",
      colorIndex: projectId ? aggregateRow?.colorIndex ?? 0 : 0,
      stats: buildStats(aggregateRow, scopedTasks, projectId, activityPanel),
      chartPath,
      chartFill,
      weeklyTrend,
      health,
      ...utilization,
    };
  }

  const projects = [];
  if (projectRows.length > 1 || isOwner) {
    projects.push(mapProjectPayload(null, null));
  }
  for (const row of projectRows) {
    projects.push(mapProjectPayload(row, row.id));
  }

  return {
    roleName,
    isOwner,
    canSeeAllProjects: isOwner,
    globalActivityFeed,
    projects,
  };
}
