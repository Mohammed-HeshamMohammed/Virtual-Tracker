
import {
  buildMemberMetaMap,
  getProjectScopedMemberIds,
  resolveActivityFeedScope,
  resolveMemberRoleName,
} from "../activity/activity-scope.js";
import { buildOpenSessionIndex } from "../activity/activity-session-status.js";
import { fetchPgAppLogs, fetchPgScreenshots } from "../../lib/postgres/activity-events-postgres.service.js";
import { resolveEffectivePresence, timestampMs as presenceTimestampMs } from "../members/services/presence-status.js";
import { loadDashboardBase, pseudoDocsFromSerialized } from "./dashboard-base-loader.js";
import { isOrgProjectAdminRole } from "../../http/project-access.js";
import {
  budgetSpent,
  getMemberProjectIds,
  getRollingWeekDays,
  normalizeRole,
  num,
  str,
  timestampMs,
  toIso,
} from "./dashboard-utils.js";
import { addLocalDays, localDayFor, localMidnightUtc } from "../../lib/time/timezone-utils.js";
import { getMemberTimezone } from "../reports/member-timezones.js";

function getLastNDays(n, timeZone = "UTC") {
  const days = [];
  const today = localDayFor(new Date(), timeZone);
  for (let i = n - 1; i >= 0; i--) {
    const dateKey = addLocalDays(today, -i);
    const startMs = localMidnightUtc(dateKey, timeZone).getTime();
    days.push({
      dateKey,
      startMs,
      endMs: localMidnightUtc(addLocalDays(dateKey, 1), timeZone).getTime() - 1,
    });
  }
  return days;
}

function relativeTime(iso) {
  if (!iso) return "Unknown";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "Now";
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function trackingToStatus(trackingStatus) {
  if (trackingStatus === "active" || trackingStatus === "tracking") return "Working";
  if (trackingStatus === "idle" || trackingStatus === "online") return "Idle";
  return "Offline";
}

function relativeTimeFromPresence(lastSeenAt) {
  const ms = presenceTimestampMs(lastSeenAt);
  if (!ms) return "Unknown";
  const diffMs = Date.now() - ms;
  if (diffMs < 60_000) return "Now";
  const minutes = Math.max(1, Math.round(diffMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function inMemberScope(memberId, memberIds) {
  if (memberIds === null) return true;
  return memberIds.includes(memberId);
}

function buildSparklineFromDays(dayBuckets, days) {
  return days.map((day) => {
    const bucket = dayBuckets.get(day.dateKey);
    return bucket ?? 0;
  });
}

export function buildViewPayload({
  memberIds,
  timeEntries,
  sessions,
  screenshots,
  appLogs,
  tasks,
  projectRows,
  budgets,
  sessionIndex,
  presenceByMember,
  memberMeta,
  projectNameById,
  viewerMemberId,
  timeZone = "UTC",
}) {
  // This is the viewer's own dashboard - "today" and "this week" are the
  // viewer's own local day/week, not the server's. Using startOfDay() here
  // (an instant) and re-deriving a date string from its UTC ISO form would
  // be wrong by a day near midnight in any zone ahead of or behind UTC;
  // localDayFor asks directly, in the zone that actually matters.
  const todayKey = localDayFor(new Date(), timeZone);
  const weekDays = getRollingWeekDays(timeZone);
  const weekDateKeys = new Set(weekDays.map((d) => d.dateKey));
  const sparkDays = getLastNDays(6, timeZone);

  const workedByDay = new Map();
  const spentByDay = new Map();
  const activityByDay = new Map();
  const membersByDay = new Map();
  const projectsByDay = new Map();

  for (const entry of timeEntries) {
    if (!inMemberScope(entry.memberId, memberIds)) continue;
    const dateKey = entry.date?.slice(0, 10);
    if (!dateKey) continue;
    const hours = entry.durationMinutes / 60;
    workedByDay.set(dateKey, (workedByDay.get(dateKey) ?? 0) + hours);
    if (entry.billable) {
      spentByDay.set(dateKey, (spentByDay.get(dateKey) ?? 0) + hours);
    }
    if (dateKey === todayKey && entry.projectId) {
      const set = projectsByDay.get(dateKey) ?? new Set();
      set.add(entry.projectId);
      projectsByDay.set(dateKey, set);
    }
    if (dateKey === todayKey) {
      const mset = membersByDay.get(dateKey) ?? new Set();
      mset.add(entry.memberId);
      membersByDay.set(dateKey, mset);
    }
  }

  for (const session of sessions) {
    const sessionMemberId = str(session, "member_id", "memberId");
    if (!inMemberScope(sessionMemberId, memberIds)) continue;
    const startedMs = timestampMs(session.started_at ?? session.startedAt);
    const startedKey = new Date(startedMs).toISOString().slice(0, 10);
    const activeSec = num(session, "active_seconds", "activeSeconds");
    const hours = activeSec / 3600;
    if (weekDateKeys.has(startedKey)) {
      workedByDay.set(startedKey, (workedByDay.get(startedKey) ?? 0) + hours);
    }
    if (startedKey === todayKey) {
      const mset = membersByDay.get(todayKey) ?? new Set();
      mset.add(sessionMemberId);
      membersByDay.set(todayKey, mset);
      const sessionProjectId =
        session.project_id ?? tasks.find((t) => t.id === session.task_id)?.projectId ?? null;
      if (sessionProjectId) {
        const pset = projectsByDay.get(todayKey) ?? new Set();
        pset.add(sessionProjectId);
        projectsByDay.set(todayKey, pset);
      }
    }
  }

  let activityTodaySum = 0;
  let activityTodayCount = 0;

  for (const shot of screenshots) {
    if (!inMemberScope(shot.memberId, memberIds)) continue;
    const capturedKey = shot.capturedAt?.slice(0, 10);
    if (!capturedKey) continue;
    const level = shot.activityLevel ?? 0;
    activityByDay.set(capturedKey, activityByDay.get(capturedKey) ?? []);
    activityByDay.get(capturedKey).push(level);
    if (capturedKey === todayKey) {
      activityTodaySum += level;
      activityTodayCount += 1;
    }
  }

  const activitySparkline = sparkDays.map((day) => {
    const levels = activityByDay.get(day.dateKey) ?? [];
    if (!levels.length) return 0;
    return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  });

  const workedTodayHours = workedByDay.get(todayKey) ?? 0;
  const workedWeekHours = weekDays.reduce((sum, d) => sum + (workedByDay.get(d.dateKey) ?? 0), 0);
  const spentTodayHours = spentByDay.get(todayKey) ?? 0;
  const spentWeekHours = weekDays.reduce((sum, d) => sum + (spentByDay.get(d.dateKey) ?? 0), 0);

  const membersWorkedToday = (membersByDay.get(todayKey) ?? new Set()).size;
  const projectsWorkedToday = (projectsByDay.get(todayKey) ?? new Set()).size;

  const membersSparkline = sparkDays.map((day) => (membersByDay.get(day.dateKey) ?? new Set()).size);
  const projectsSparkline = sparkDays.map((day) => (projectsByDay.get(day.dateKey) ?? new Set()).size);

  const scopedTasks = tasks.filter((task) => {
    if (memberIds === null) return true;
    if (task.assigneeId && memberIds.includes(task.assigneeId)) return true;
    return false;
  });

  const todos = scopedTasks
    .filter((task) => task.status !== "done" && task.status !== "archived")
    .sort((a, b) => b.updatedMs - a.updatedMs)
    .slice(0, 8)
    .map((task) => ({
      id: task.id,
      title: task.title,
      projectName: projectNameById.get(task.projectId) || "Project",
      status: task.status,
      priority: task.priority,
      done: false,
    }));

  const onlineMembers = [];
  const memberIdList =
    memberIds === null ? [...memberMeta.keys()] : memberIds.filter((id) => memberMeta.has(id));

  for (const memberId of memberIdList) {
    const meta = memberMeta.get(memberId) || { name: "Unknown", initials: "??" };
    const presence = presenceByMember.get(memberId) ?? resolveEffectivePresence(null, {});
    const trackingStatus = presence.trackingStatus;
    const status = trackingToStatus(trackingStatus);
    const session = sessionIndex.get(memberId) ?? null;
    let project = "";
    if (status === "Working" && session) {
      const projectId =
        session.project_id ?? tasks.find((t) => t.id === session.task_id)?.projectId ?? null;
      project = projectNameById.get(projectId) || "";
    }
    const activeSec = session ? num(session, "active_seconds", "activeSeconds") : 0;
    onlineMembers.push({
      id: memberId,
      name: memberId === viewerMemberId ? "You" : meta.name,
      initials: meta.initials,
      status,
      lastActive: relativeTimeFromPresence(presence.lastSeenAt),
      project,
      time: status === "Working" ? formatDuration(activeSec) : "",
    });
  }

  onlineMembers.sort((a, b) => {
    const order = { Working: 0, Idle: 1, Offline: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  const recentProjects = projectRows
    .slice()
    .sort((a, b) => b.updatedMs - a.updatedMs)
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      name: row.name,
      progress: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
      memberCount: row.members,
      colorIndex: row.colorIndex,
    }));

  const budgetRows = budgets.slice(0, 5).map((row) => ({
    id: row.id,
    name: row.name,
    spentPercent: row.spentPercent,
    total: row.total,
    remaining: row.remaining,
    spent: row.spent,
  }));

  const appTotals = new Map();
  let appTotalSeconds = 0;
  for (const log of appLogs) {
    if (!inMemberScope(log.memberId, memberIds)) continue;
    const name = log.appName || "Unknown";
    appTotals.set(name, (appTotals.get(name) ?? 0) + log.durationSeconds);
    appTotalSeconds += log.durationSeconds;
  }

  const topApps = [...appTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, totalSeconds]) => ({
      name,
      totalSeconds,
      percent: appTotalSeconds > 0 ? Math.round((totalSeconds / appTotalSeconds) * 100) : 0,
    }));

  const weeklyActivity = weekDays.map((day) => {
    const daySessions = sessions.filter((s) => {
      if (!inMemberScope(str(s, "member_id", "memberId"), memberIds)) return false;
      const startedMs = timestampMs(s.started_at ?? s.startedAt);
      return startedMs >= day.startMs && startedMs <= day.endMs;
    });
    let activeSec = 0;
    let idleSec = 0;
    for (const s of daySessions) {
      activeSec += num(s, "active_seconds", "activeSeconds");
      idleSec += num(s, "idle_seconds", "idleSeconds");
    }
    return {
      key: day.key,
      label: day.label,
      activeHours: Math.round((activeSec / 3600) * 10) / 10,
      idleHours: Math.round((idleSec / 3600) * 10) / 10,
    };
  });

  const { chartPath, chartFill } = buildTrendPaths(weeklyActivity.map((d) => d.activeHours));

  const weekActiveHoursTotal = weeklyActivity.reduce((sum, d) => sum + d.activeHours, 0);
  const weekIdleHoursTotal = weeklyActivity.reduce((sum, d) => sum + d.idleHours, 0);
  const activityWeekPercent =
    weekActiveHoursTotal + weekIdleHoursTotal > 0
      ? Math.round((weekActiveHoursTotal / (weekActiveHoursTotal + weekIdleHoursTotal)) * 100)
      : 0;

  return {
    stats: {
      workedTodayHours: Math.round(workedTodayHours * 100) / 100,
      workedWeekHours: Math.round(workedWeekHours * 100) / 100,
      workedSparkline: buildSparklineFromDays(workedByDay, sparkDays),
      spentTodayHours: Math.round(spentTodayHours * 100) / 100,
      spentWeekHours: Math.round(spentWeekHours * 100) / 100,
      spentSparkline: buildSparklineFromDays(spentByDay, sparkDays),
      activityTodayPercent: activityTodayCount ? Math.round(activityTodaySum / activityTodayCount) : 0,
      activityWeekPercent,
      activitySparkline,
      membersWorkedToday,
      membersSparkline,
      projectsWorkedToday,
      projectsSparkline,
    },
    todos,
    onlineMembers: onlineMembers.slice(0, 12),
    recentProjects,
    budgets: budgetRows,
    weeklyActivity,
    chartPath,
    chartFill,
    topApps,
  };
}

function buildTrendPaths(values) {
  const width = 800;
  const height = 200;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 24 - (value / max) * (height - 48);
    return { x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return { chartPath: line, chartFill: `${line} V${height} H0 Z` };
}

export async function getGeneralDashboardPayload(db, viewerMemberId) {
  const timeZone = await getMemberTimezone(viewerMemberId);
  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);
  const isOwner = roleKey === "owner";
  const canAccessAllView = isOwner || ["superadmin", "admin", "supermanager", "manager"].includes(roleKey);

  const seesAllProjects = isOrgProjectAdminRole(roleName);
  const scope = await resolveActivityFeedScope(db, viewerMemberId, {
    memberId: "all",
    projectScopeOnly: !seesAllProjects,
  });

  const allMemberIds = scope.targetMemberIds;
  const meMemberIds = [viewerMemberId];

  const weekDays = getRollingWeekDays(timeZone);
  const weekStartKey = weekDays[0].dateKey;

  const sparkStartDay = getLastNDays(6, timeZone)[0].dateKey;
  const base = await loadDashboardBase(db);
  const [screenshotRows, appRows, sessionIndex] = await Promise.all([
    fetchPgScreenshots(allMemberIds, null, 5000, { sinceDay: sparkStartDay }),
    fetchPgAppLogs(allMemberIds, null, 5000, { sinceDay: sparkStartDay }),
    buildOpenSessionIndex(),
  ]);

  const timeEntriesSnap = { docs: pseudoDocsFromSerialized(base.timeEntries) };
  const sessionsSnap = { docs: pseudoDocsFromSerialized(base.sessions) };
  const tasksSnap = { docs: pseudoDocsFromSerialized(base.tasks) };
  const projectsSnap = { docs: pseudoDocsFromSerialized(base.projects) };
  const budgetsSnap = { docs: pseudoDocsFromSerialized(base.budgets) };
  const projectMembersSnap = { docs: pseudoDocsFromSerialized(base.projectMembers) };

  const allowedProjectIds = await getMemberProjectIds(db, viewerMemberId, roleName);

  const memberCountByProject = new Map();
  for (const doc of projectMembersSnap.docs) {
    const row = doc.data() || {};
    const pid = str(row, "project_id", "projectId");
    if (!pid) continue;
    memberCountByProject.set(pid, (memberCountByProject.get(pid) ?? 0) + 1);
  }

  const budgetByProject = new Map();
  for (const doc of budgetsSnap.docs) {
    const row = doc.data() || {};
    const pid = str(row, "project_id", "projectId");
    if (pid && !budgetByProject.has(pid)) budgetByProject.set(pid, row);
  }

  const timeEntries = [];
  for (const doc of timeEntriesSnap.docs) {
    const row = doc.data() || {};
    const dateKey = str(row, "date");
    if (dateKey && dateKey < weekStartKey) continue;
    timeEntries.push({
      memberId: str(row, "member_id", "memberId"),
      projectId: str(row, "project_id", "projectId"),
      date: dateKey,
      durationMinutes: num(row, "duration"),
      billable: row.billable === true,
    });
  }

  const sessions = sessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const assigneeIds = new Set();
  const tasks = tasksSnap.docs.map((doc) => {
    const row = doc.data() || {};
    const assigneeId = str(row, "assigned_to", "assignedTo") || null;
    if (assigneeId) assigneeIds.add(assigneeId);
    return {
      id: doc.id,
      projectId: str(row, "project_id", "projectId"),
      title: str(row, "title") || "Untitled",
      status: str(row, "status") || "todo",
      priority: str(row, "priority") || "medium",
      assigneeId,
      updatedMs: timestampMs(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt),
    };
  });

  const memberMeta = await buildMemberMetaMap(db, allMemberIds === null ? null : [...new Set([...(allMemberIds ?? []), viewerMemberId])]);

  const projectRows = [];
  const budgets = [];
  let colorIndex = 0;

  for (const doc of projectsSnap.docs) {
    if (allowedProjectIds !== null && !allowedProjectIds.has(doc.id)) continue;
    const row = doc.data() || {};
    const status = (str(row, "status") || "active").toLowerCase();
    if (status === "archived") continue;

    const projectTasks = tasks.filter((t) => t.projectId === doc.id);
    const done = projectTasks.filter((t) => t.status === "done").length;
    const total = projectTasks.length;
    const members = memberCountByProject.get(doc.id) ?? 0;
    const name = str(row, "name") || "Untitled project";
    const updatedMs = timestampMs(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt);

    projectRows.push({
      id: doc.id,
      name,
      done,
      total,
      members: members > 0 ? members : 1,
      colorIndex: colorIndex % 10,
      updatedMs,
    });

    const budgetRow = budgetByProject.get(doc.id);
    if (budgetRow) {
      const totalCost = num(budgetRow, "cost");
      const spent = budgetSpent(totalCost, budgetRow);
      const spentPercent = totalCost > 0 ? Math.min(100, Math.round((spent / totalCost) * 100)) : 0;
      budgets.push({
        id: doc.id,
        name,
        spentPercent,
        total: totalCost,
        remaining: Math.max(0, totalCost - spent),
        spent,
      });
    }
    colorIndex += 1;
  }

  budgets.sort((a, b) => b.spentPercent - a.spentPercent);

  const projectNameById = new Map(projectRows.map((row) => [row.id, row.name]));

  const presenceMemberIds =
    allMemberIds === null
      ? [...memberMeta.keys()]
      : [...new Set([...(allMemberIds ?? []), viewerMemberId])];
  const presenceByMember = await buildPresenceByMember(db, presenceMemberIds);

  const screenshots = screenshotRows.map((d) => ({
    memberId: String(d.member_id ?? ""),
    capturedAt: toIso(d.captured_at) ?? "",
    activityLevel: d.activity_level ?? 0,
  }));

  const appLogs = appRows.map((d) => ({
    memberId: String(d.member_id ?? ""),
    appName: d.app_name || "Unknown",
    durationSeconds: typeof d.duration_seconds === "number" ? d.duration_seconds : 0,
  }));

  const shared = {
    timeEntries,
    sessions,
    tasks,
    projectRows,
    budgets,
    sessionIndex,
    presenceByMember,
    memberMeta,
    projectNameById,
    screenshots,
    appLogs,
    viewerMemberId,
    timeZone,
  };

  return {
    roleName,
    canAccessAllView,
    me: buildViewPayload({ ...shared, memberIds: meMemberIds }),
    all: buildViewPayload({ ...shared, memberIds: allMemberIds }),
  };
}

import { getMembersByIdsPg } from "../../lib/postgres/members-postgres.service.js";

async function buildPresenceByMember(db, memberIds) {
  const { getPresenceService } = await import("../presence/index.js");
  const presenceService = getPresenceService();
  const map = new Map();
  if (!memberIds.length) return map;
  const memberRows = await getMembersByIdsPg(memberIds);
  for (const row of memberRows) {
    if (!row || !row.id) continue;
    const runtime = presenceService.getPresence(row.id);
    map.set(row.id, resolveEffectivePresence(runtime, row));
  }
  return map;
}

