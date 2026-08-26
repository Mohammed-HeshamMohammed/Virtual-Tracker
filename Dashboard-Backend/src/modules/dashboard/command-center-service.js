// Command Center aggregates, scoped by viewer role.

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
    // Real progress the task tracker maintains, rather than a number inferred
    // from the status column.
    progressPercent: num(row, "aggregated_progress_percent", "aggregatedProgressPercent"),
    activeSeconds: num(row, "total_active_seconds", "totalActiveSeconds"),
  };
}

/**
 * Weekly productivity trend from time actually worked.
 *
 * This used to count task rows whose updated_at happened to fall on a day and
 * call that "active"/"idle" - so a day where someone worked eight hours on one
 * task scored 1, and touching five tickets without tracking anything scored 5.
 * `dailyTotals` is real per-day active/idle seconds; the task list is still
 * carried per day for the drill-down the UI shows on hover.
 */
function buildWeeklyTrend(tasks, projectId, dailyTotals) {
  const days = getRollingWeekDays();
  const scoped = projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;

  return days.map((day) => {
    const dayTasks = scoped.filter((task) => task.updatedMs >= day.startMs && task.updatedMs <= day.endMs);
    const totals = dailyTotals.get(day.dateKey) ?? { activeSeconds: 0, idleSeconds: 0 };
    return {
      key: day.key,
      label: day.label,
      // Hours worked, to one decimal - the series the chart plots.
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

/**
 * Utilisation: hours worked against the member's own weekly capacity.
 *
 * This used to be `min(100, activeTaskCount / 3 * 100)` - three in-progress
 * tickets read as 100% utilised regardless of whether anyone tracked a minute,
 * and the 3 was arbitrary. Capacity comes from the member's configured weekly
 * limit, falling back to their working-days count at 8h/day.
 */
function buildUtilization(memberSeconds, capacityByMember) {
  let optimal = 0;
  let over = 0;
  let under = 0;
  let pctSum = 0;
  let count = 0;

  for (const [memberId, seconds] of memberSeconds.entries()) {
    const capacity = capacityByMember.get(memberId) ?? 0;
    if (capacity <= 0) continue;
    count += 1;
    const pct = Math.round((seconds / capacity) * 100);
    pctSum += Math.min(150, pct);
    // Under 60% of capacity is slack, over 100% is overloaded.
    if (pct > 100) over += 1;
    else if (pct >= 60) optimal += 1;
    else under += 1;
  }

  const utilizationPercent = count ? Math.round(pctSum / count) : 0;
  // The gauge arc is 251.2 long; clamp the visual at 100% even when someone is
  // over capacity, so the ring cannot wrap past full.
  const utilizationOffset = Math.max(0, 251.2 - (Math.min(100, utilizationPercent) / 100) * 251.2);
  return {
    utilizationPercent,
    utilizationOffset,
    utilizationMembers: { optimal, over, under },
  };
}

/**
 * Milestone bars for the health panel.
 *
 * Progress is `tasks.aggregated_progress_percent`, which the task tracker
 * already maintains, rather than a number inferred from the status column
 * (in_progress used to mean "55%" for every task regardless of how far along
 * it was). Tasks in flight are surfaced first - a milestone panel showing four
 * arbitrary rows is not telling anyone anything.
 *
 * A project with no tasks reports 0%, not the invented 85/45/15 this used to
 * return based on its health label.
 */
function buildHealthMilestones(tasks, projectId, fallbackName, fallbackHealth) {
  const scoped = tasks.filter((task) => task.projectId === projectId);
  if (!scoped.length) {
    return [{ name: fallbackName, percent: 0, health: fallbackHealth, empty: true }];
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
    return { name: task.title, percent, health };
  });
}

/**
 * The four stat cards.
 *
 * Every number here used to be derived from task rows:
 *   timeWorked      = (non-todo task count) x 2 hours, i.e. invented outright
 *   activeMembers   = task assignees, floored at 1 so it never read zero
 *   activityPercent = task completion %, badged PEAK/HIGH/LOW as if it were
 *                     the activity meter the rest of the app means by that word
 * They now come from tracked time, matching what the Time & Activity report
 * and the Projects Overview page report for the same period.
 */
function buildStats(projectRow, projectId, metrics) {
  const activeSeconds = metrics?.activeSeconds ?? 0;
  const idleSeconds = metrics?.idleSeconds ?? 0;
  const trackedSeconds = activeSeconds + idleSeconds;

  const budgetPct =
    projectRow?.budgetTotal > 0
      ? Math.min(100, Math.round((projectRow.budgetSpent / projectRow.budgetTotal) * 100))
      : 0;

  // The app's activity meter everywhere else: active out of active+idle.
  const activityPercent = trackedSeconds > 0 ? Math.round((activeSeconds / trackedSeconds) * 100) : 0;

  return {
    timeWorked: formatSecondsAsHours(activeSeconds),
    // Members who actually tracked time in the window - 0 is a real answer.
    activeMembers: String(metrics?.memberIds?.size ?? 0),
    totalMembers: String(Math.max(projectRow?.members ?? 0, 0)),
    budgetPercent: budgetPct,
    budgetLabel: projectRow?.budgetTotal > 0 ? "Budget Used" : "No Budget",
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

/** Seconds -> "7h 30m" style label for the stat card. */
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} viewerMemberId
 */
export async function getCommandCenterPayload(db, viewerMemberId) {
  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);
  const isOwner = roleKey === "owner";
  // Owner, Super Admin, Admin and Super Manager all see the whole org here -
  // the same set getViewerProjectIds returns null for. Keying the org-wide
  // view off `isOwner` alone was what left an Admin looking at "No projects
  // yet" on a populated org.
  const seesAllProjects = isOrgProjectAdminRole(roleName);
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
      // No floor: a project with nobody on it reports 0, not 1.
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

  // Real tracked-time metrics for the same rolling week the trend chart shows,
  // scoped to the projects this viewer may see. One round trip each, reused by
  // every project payload below.
  const weekDays = getRollingWeekDays();
  const weekFrom = weekDays[0].dateKey;
  const weekTo = weekDays[weekDays.length - 1].dateKey;
  const metricProjectIds = allowedProjectIdList === null ? null : allowedProjectIdList;
  const [projectMetrics, dailyTotalsAll, capacityByMember] = await Promise.all([
    getProjectActivityMetricsPg({ projectIds: metricProjectIds, fromDay: weekFrom, toDay: weekTo }),
    getDailyActivityTotalsPg({ projectIds: metricProjectIds, fromDay: weekFrom, toDay: weekTo }),
    getMemberWeeklyCapacityPg(null),
  ]);

  /** Seconds worked per member across a project scope, for utilisation. */
  function memberSecondsFor(projectId) {
    const perMember = new Map();
    const entries = projectId
      ? [[projectId, projectMetrics.get(projectId)]]
      : [...projectMetrics.entries()];
    for (const [, metrics] of entries) {
      if (!metrics) continue;
      // Session rows carry the member set but not per-member seconds; splitting
      // the project total evenly across its trackers is the honest
      // approximation available without a second per-member roll-up, and the
      // gauge is a team-level indicator rather than a payroll figure.
      const share = metrics.memberIds.size > 0 ? metrics.activeSeconds / metrics.memberIds.size : 0;
      for (const memberId of metrics.memberIds) {
        perMember.set(memberId, (perMember.get(memberId) ?? 0) + share);
      }
    }
    return perMember;
  }

  /** Aggregate metrics across every in-scope project. */
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

  const scope = await resolveActivityFeedScope(db, viewerMemberId, {
    memberId: "all",
    projectScopeOnly: !seesAllProjects,
  });
  let activityMemberIds = scope.targetMemberIds;
  if (!seesAllProjects && allowedProjectIdList?.length) {
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

  async function mapProjectPayload(projectRow, projectId) {
    // The all-projects card reuses the scope-wide totals already loaded; a
    // single project needs its own per-day series.
    const dailyTotals = projectId
      ? await getDailyActivityTotalsPg({ projectIds: [projectId], fromDay: weekFrom, toDay: weekTo })
      : dailyTotalsAll;
    const weeklyTrend = buildWeeklyTrend(scopedTasks, projectId, dailyTotals);
    const activeSeries = weeklyTrend.map((day) => day.active);
    const { chartPath, chartFill } = buildTrendPaths(activeSeries);
    const utilization = buildUtilization(memberSecondsFor(projectId), capacityByMember);
    const metrics = metricsFor(projectId);

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
      name: projectId ? aggregateRow?.name || "Project" : seesAllProjects ? "All Projects" : "All My Projects",
      colorIndex: projectId ? aggregateRow?.colorIndex ?? 0 : 0,
      stats: buildStats(aggregateRow, projectId, metrics),
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
    globalActivityFeed,
    projects,
  };
}
