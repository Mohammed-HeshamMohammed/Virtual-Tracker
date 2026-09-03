
import {
  buildMemberMetaMap,
  getProjectScopedMemberIds,
  resolveActivityFeedScope,
  resolveMemberRoleName,
} from "../activity/activity-scope.js";
import { fetchPgScreenshots } from "../../lib/postgres/activity-events-postgres.service.js";
import { isOrgProjectAdminRole } from "../../http/project-access.js";
import {
  getDailyActivityTotalsPg,
  getMemberActivitySecondsPg,
  getMemberDailyActivityTotalsPg,
  getMemberProjectActivityMetricsPg,
  getMemberWeeklyCapacityPg,
  getProjectActivityMetricsPg,
} from "../../lib/postgres/projects-postgres.service.js";
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

const PERSONAL_VIEW_ROLES = new Set(["employee", "intern"]);

function shiftDay(day, delta) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

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
    progressPercent: num(row, "aggregated_progress_percent", "aggregatedProgressPercent"),
    activeSeconds: num(row, "total_active_seconds", "totalActiveSeconds"),
  };
}

function buildWeeklyTrend(tasks, projectId, dailyTotals) {
  const days = getRollingWeekDays();
  const scoped = projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;

  return days.map((day) => {
    const dayTasks = scoped.filter((task) => task.updatedMs >= day.startMs && task.updatedMs <= day.endMs);
    const totals = dailyTotals.get(day.dateKey) ?? { activeSeconds: 0, idleSeconds: 0 };
    return {
      key: day.key,
      label: day.label,
      active: Math.round((totals.activeSeconds / 3600) * 10) / 10,
      idle: Math.round((totals.idleSeconds / 3600) * 10) / 10,
      activeSeconds: totals.activeSeconds,
      idleSeconds: totals.idleSeconds,
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

function buildUtilization(memberSeconds, capacityByMember, memberMeta) {
  let optimal = 0;
  let over = 0;
  let under = 0;
  let pctSum = 0;
  let count = 0;
  const members = [];

  for (const [memberId, seconds] of memberSeconds.entries()) {
    const capacity = capacityByMember.get(memberId) ?? 0;
    if (capacity <= 0) continue;
    count += 1;
    const pct = Math.round((seconds / capacity) * 100);
    pctSum += Math.min(150, pct);
    let load = "under";
    if (pct > 100) {
      over += 1;
      load = "over";
    } else if (pct >= 60) {
      optimal += 1;
      load = "optimal";
    } else {
      under += 1;
    }

    const meta = memberMeta?.get(memberId) || { name: "Team member", initials: "??" };
    members.push({
      id: memberId,
      name: meta.name,
      initials: meta.initials,
      percent: pct,
      hours: Math.round((seconds / 3600) * 10) / 10,
      capacityHours: Math.round((capacity / 3600) * 10) / 10,
      load,
    });
  }

  members.sort((a, b) => b.percent - a.percent);
  const utilizationPercent = count ? Math.round(pctSum / count) : 0;
  const utilizationOffset = Math.max(0, 251.2 - (Math.min(100, utilizationPercent) / 100) * 251.2);
  return {
    utilizationPercent,
    utilizationOffset,
    utilizationMembers: { optimal, over, under },
    utilizationBreakdown: members.slice(0, 8),
  };
}

function buildHealthMilestones(tasks, projectId, projectRow) {
  const scoped = tasks.filter((task) => task.projectId === projectId);
  if (!scoped.length) {
    return [projectProgressRow(projectRow)];
  }

  const rank = { blocked: 0, in_progress: 1, in_review: 2, todo: 3, done: 4 };
  const ordered = [...scoped]
    .sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || b.updatedMs - a.updatedMs)
    .slice(0, 4);

  return ordered.map((task) => {
    const percent =
      task.status === "done"
        ? 100
        : Number.isFinite(task.progressPercent) && task.progressPercent > 0
          ? Math.min(100, Math.round(task.progressPercent))
          : 0;
    const health = task.status === "blocked" ? "stalled" : task.status === "done" || task.status === "in_review" ? "on_track" : "at_risk";
    return { name: task.title, percent, health, metric: "progress" };
  });
}

function projectProgressRow(projectRow) {
  const total = projectRow?.total ?? 0;
  if (total > 0) {
    return {
      name: projectRow?.name || "Project",
      percent: Math.round(((projectRow?.done ?? 0) / total) * 100),
      health: projectRow?.health || "on_track",
      metric: "progress",
    };
  }

  const hasOverride = projectRow?.budgetPercentOverride !== undefined;
  if (hasOverride && projectRow.budgetPercentOverride !== null) {
    const percent = projectRow.budgetPercentOverride;
    return {
      name: projectRow?.name || "Project",
      percent,
      health: percent > 100 ? "stalled" : percent >= 90 ? "at_risk" : "on_track",
      metric: "budget",
    };
  }

  const budgetTotal = hasOverride ? 0 : (projectRow?.budgetTotal ?? 0);
  if (budgetTotal > 0) {
    const percent = Math.round(((projectRow?.budgetSpent ?? 0) / budgetTotal) * 100);
    return {
      name: projectRow?.name || "Project",
      percent: Math.min(100, percent),
      health: percent > 100 ? "stalled" : percent >= 90 ? "at_risk" : "on_track",
      metric: "budget",
    };
  }

  return {
    name: projectRow?.name || "Project",
    percent: 0,
    health: projectRow?.health || "on_track",
    metric: "none",
  };
}

function averageBudgetPercent(projectRows) {
  const withBudget = projectRows.filter((row) => row.budgetTotal > 0);
  if (!withBudget.length) return null;
  const percents = withBudget.map((row) => Math.min(100, Math.round((row.budgetSpent / row.budgetTotal) * 100)));
  return Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length);
}

function buildStats(projectRow, projectId, metrics, prevActiveSeconds) {
  const activeSeconds = metrics?.activeSeconds ?? 0;
  const idleSeconds = metrics?.idleSeconds ?? 0;
  const trackedSeconds = activeSeconds + idleSeconds;

  const hasOverride = projectRow?.budgetPercentOverride !== undefined;
  const hasBudget = hasOverride ? projectRow.budgetPercentOverride !== null : projectRow?.budgetTotal > 0;
  const budgetPct = hasOverride
    ? (projectRow.budgetPercentOverride ?? 0)
    : hasBudget
      ? Math.min(100, Math.round((projectRow.budgetSpent / projectRow.budgetTotal) * 100))
      : 0;

  const activityPercent = trackedSeconds > 0 ? Math.round((activeSeconds / trackedSeconds) * 100) : 0;

  const timeWorkedTrendPercent =
    prevActiveSeconds > 0
      ? Math.round(((activeSeconds - prevActiveSeconds) / prevActiveSeconds) * 100)
      : null;

  return {
    timeWorked: formatSecondsAsHours(activeSeconds),
    timeWorkedTrendPercent,
    activeMembers: String(metrics?.memberIds?.size ?? 0),
    totalMembers: String(Math.max(projectRow?.members ?? 0, 0)),
    budgetPercent: budgetPct,
    budgetLabel: hasBudget ? "Budget Used" : "No Budget",
    activityPercent,
    activityBadge:
      trackedSeconds === 0
        ? "IDLE"
        : activityPercent >= 85
          ? "PEAK"
          : activityPercent >= 70
            ? "HIGH"
            : activityPercent >= 50
              ? "GOOD"
              : activityPercent >= 30
                ? "LOW"
                : "IDLE",
  };
}

function formatSecondsAsHours(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.round((safe % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

export async function getCommandCenterPayload(db, viewerMemberId) {
  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);
  const isOwner = roleKey === "owner";
  const seesAllProjects = isOrgProjectAdminRole(roleName);
  const isPersonalView = PERSONAL_VIEW_ROLES.has(roleKey);
  const allowedProjectIds = await getMemberProjectIds(db, viewerMemberId, roleName);

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

  const memberIdsByProject = new Map();
  for (const doc of projectMembersSnap.docs) {
    const row = doc.data() || {};
    const pid = str(row, "project_id", "projectId");
    const mid = str(row, "member_id", "memberId");
    if (!pid || !mid) continue;
    if (!memberIdsByProject.has(pid)) memberIdsByProject.set(pid, new Set());
    memberIdsByProject.get(pid).add(mid);
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
    const members = memberIdsByProject.get(doc.id)?.size ?? 0;
    const inProgress = projectTasks.filter((task) => task.status === "in_progress").length;

    projectRows.push({
      id: doc.id,
      name: str(row, "name") || "Untitled project",
      colorIndex: colorIndex % PROJECT_COLORS,
      health,
      members,
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

  const weekDays = getRollingWeekDays();
  const weekFrom = weekDays[0].dateKey;
  const weekTo = weekDays[weekDays.length - 1].dateKey;
  const metricProjectIds = allowedProjectIdList === null ? null : allowedProjectIdList;
  const prevFrom = shiftDay(weekFrom, -7);
  const prevTo = shiftDay(weekTo, -7);
  const [
    projectMetrics,
    dailyTotalsAll,
    capacityByMember,
    prevMetrics,
    memberSecondsByProject,
    personalMetrics,
    prevPersonalMetrics,
  ] = await Promise.all([
    getProjectActivityMetricsPg({ projectIds: metricProjectIds, fromDay: weekFrom, toDay: weekTo }),
    isPersonalView
      ? getMemberDailyActivityTotalsPg({ projectIds: metricProjectIds, memberId: viewerMemberId, fromDay: weekFrom, toDay: weekTo })
      : getDailyActivityTotalsPg({ projectIds: metricProjectIds, fromDay: weekFrom, toDay: weekTo }),
    getMemberWeeklyCapacityPg(null),
    getProjectActivityMetricsPg({ projectIds: metricProjectIds, fromDay: prevFrom, toDay: prevTo }),
    getMemberActivitySecondsPg({ projectIds: metricProjectIds, fromDay: weekFrom, toDay: weekTo }),
    isPersonalView
      ? getMemberProjectActivityMetricsPg({ projectIds: metricProjectIds, memberId: viewerMemberId, fromDay: weekFrom, toDay: weekTo })
      : Promise.resolve(new Map()),
    isPersonalView
      ? getMemberProjectActivityMetricsPg({ projectIds: metricProjectIds, memberId: viewerMemberId, fromDay: prevFrom, toDay: prevTo })
      : Promise.resolve(new Map()),
  ]);

  const utilizationMemberIds = new Set();
  for (const row of projectRows) {
    for (const memberId of memberIdsByProject.get(row.id) ?? []) utilizationMemberIds.add(memberId);
    for (const memberId of memberSecondsByProject.get(row.id)?.keys() ?? []) utilizationMemberIds.add(memberId);
  }
  const utilizationMeta =
    utilizationMemberIds.size > 0 ? await buildMemberMetaMap(db, [...utilizationMemberIds]) : new Map();

  function prevActiveSecondsFor(projectId) {
    if (projectId) return prevMetrics.get(projectId)?.activeSeconds ?? 0;
    let total = 0;
    for (const metrics of prevMetrics.values()) total += metrics.activeSeconds;
    return total;
  }

  function memberSecondsFor(projectId) {
    const perMember = new Map();
    const scopeIds = projectId ? [projectId] : projectRows.map((row) => row.id);
    for (const pid of scopeIds) {
      for (const memberId of memberIdsByProject.get(pid) ?? []) {
        if (!perMember.has(memberId)) perMember.set(memberId, 0);
      }
      for (const [memberId, seconds] of memberSecondsByProject.get(pid) ?? []) {
        perMember.set(memberId, (perMember.get(memberId) ?? 0) + seconds);
      }
    }
    return perMember;
  }

  function metricsFor(projectId) {
    if (projectId) return projectMetrics.get(projectId) ?? { activeSeconds: 0, idleSeconds: 0, memberIds: new Set() };
    const all = { activeSeconds: 0, idleSeconds: 0, memberIds: new Set() };
    for (const metrics of projectMetrics.values()) {
      all.activeSeconds += metrics.activeSeconds;
      all.idleSeconds += metrics.idleSeconds;
      for (const memberId of metrics.memberIds) all.memberIds.add(memberId);
    }
    return all;
  }

  function personalMetricsFor(projectId) {
    if (projectId) return personalMetrics.get(projectId) ?? { activeSeconds: 0, idleSeconds: 0 };
    const all = { activeSeconds: 0, idleSeconds: 0 };
    for (const metrics of personalMetrics.values()) {
      all.activeSeconds += metrics.activeSeconds;
      all.idleSeconds += metrics.idleSeconds;
    }
    return all;
  }

  function prevPersonalActiveSecondsFor(projectId) {
    if (projectId) return prevPersonalMetrics.get(projectId)?.activeSeconds ?? 0;
    let total = 0;
    for (const metrics of prevPersonalMetrics.values()) total += metrics.activeSeconds;
    return total;
  }

  function personalTaskStatsFor(projectId) {
    const pool = projectId ? scopedTasks.filter((task) => task.projectId === projectId) : scopedTasks;
    const mine = pool.filter((task) => task.assigneeId === viewerMemberId);
    return {
      inProgress: mine.filter((task) => task.status === "in_progress").length,
      assigned: mine.length,
    };
  }

  let activityMemberIds = [viewerMemberId];
  if (!isPersonalView) {
    const scope = await resolveActivityFeedScope(db, viewerMemberId, {
      memberId: "all",
      projectScopeOnly: !seesAllProjects,
    });
    activityMemberIds = scope.targetMemberIds;
    if (!seesAllProjects && allowedProjectIdList?.length) {
      const projectMemberIds = await getProjectScopedMemberIds(db, viewerMemberId);
      activityMemberIds =
        activityMemberIds === null
          ? [...projectMemberIds]
          : activityMemberIds.filter((id) => projectMemberIds.has(id));
    }
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
      project: str(d, "project_name") || "Active session",
      time: relativeTime(captured || new Date().toISOString()),
      activityBadge: `${Math.round(d.activity_level ?? 0)}% Activity`,
      type: "screenshot",
      screenshotId: String(d.id ?? ""),
    };
  });

  const feedTasks = isPersonalView
    ? scopedTasks.filter((task) => task.assigneeId === viewerMemberId)
    : scopedTasks;
  const doneTaskFeed = feedTasks
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

  async function mapProjectPayload(projectRow, projectId) {
    const dailyTotals = projectId
      ? isPersonalView
        ? await getMemberDailyActivityTotalsPg({ projectIds: [projectId], memberId: viewerMemberId, fromDay: weekFrom, toDay: weekTo })
        : await getDailyActivityTotalsPg({ projectIds: [projectId], fromDay: weekFrom, toDay: weekTo })
      : dailyTotalsAll;
    const weeklyTrend = buildWeeklyTrend(feedTasks, projectId, dailyTotals);
    const activeSeries = weeklyTrend.map((day) => day.active);
    const { chartPath, chartFill } = buildTrendPaths(activeSeries);
    const utilization = buildUtilization(memberSecondsFor(projectId), capacityByMember, utilizationMeta);
    const metrics = isPersonalView ? personalMetricsFor(projectId) : metricsFor(projectId);
    const prevActiveSeconds = isPersonalView
      ? prevPersonalActiveSecondsFor(projectId)
      : prevActiveSecondsFor(projectId);

    const aggregateRow = projectId
      ? projectRows.find((row) => row.id === projectId)
      : {
          members: new Set(
            projectRows.flatMap((row) => [...(memberIdsByProject.get(row.id) ?? [])]),
          ).size,
          budgetTotal: 0,
          budgetSpent: 0,
          budgetPercentOverride: averageBudgetPercent(projectRows),
          done: projectRows.reduce((sum, row) => sum + row.done, 0),
          total: projectRows.reduce((sum, row) => sum + row.total, 0),
          health: "on_track",
        };

    const health = projectId
      ? buildHealthMilestones(scopedTasks, projectId, aggregateRow)
      :
        projectRows.slice(0, 4).map((row) => projectProgressRow(row));

    return {
      id: projectId ?? "all",
      name: projectId ? aggregateRow?.name || "Project" : seesAllProjects ? "All Projects" : "All My Projects",
      colorIndex: projectId ? aggregateRow?.colorIndex ?? 0 : 0,
      stats: buildStats(aggregateRow, projectId, metrics, prevActiveSeconds),
      personalTaskStats: isPersonalView ? personalTaskStatsFor(projectId) : null,
      chartPath,
      chartFill,
      weeklyTrend,
      health,
      ...utilization,
    };
  }

  const projects = [];
  if (projectRows.length > 1 || seesAllProjects) {
    projects.push(await mapProjectPayload(null, null));
  }
  for (const row of projectRows) {
    projects.push(await mapProjectPayload(row, row.id));
  }

  return {
    roleName,
    isOwner,
    canSeeAllProjects: seesAllProjects,
    isPersonalView,
    globalActivityFeed,
    projects,
  };
}
