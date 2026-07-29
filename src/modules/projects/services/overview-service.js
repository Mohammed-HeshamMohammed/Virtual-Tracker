// Project overview aggregates — minimal fields, server-side joins.

import { query as pgQuery } from "../../../lib/postgres/client.js";
import { computeProjectSpentPg } from "../../../lib/postgres/projects-postgres.service.js";

function toIso(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function str(row, ...keys) {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function num(row, ...keys) {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function calculateHealth(status, tasksForProject) {
  if (status === "archived") return "stalled";
  if (!tasksForProject.length) return "on_track";
  const done = tasksForProject.filter((t) => t.status === "done").length;
  const progress = done / tasksForProject.length;
  if (progress >= 0.7) return "on_track";
  if (progress >= 0.3) return "at_risk";
  return "stalled";
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ allowedProjectIds?: Set<string> | null }} [options]
 */
export async function getOverviewCore(db, options = {}) {
  const allowed = options.allowedProjectIds ?? null;
  const [projectRows, budgetRows, memberRows, limitRows, taskRows] = await Promise.all([
    pgQuery("SELECT id, status, name FROM projects LIMIT 200"),
    pgQuery("SELECT project_id, cost, type, based_on, include_non_billable_time FROM project_budgets LIMIT 200"),
    pgQuery("SELECT project_id, member_id FROM project_members LIMIT 2000"),
    pgQuery("SELECT project_id, cost FROM project_member_limits LIMIT 200"),
    pgQuery("SELECT project_id, status FROM tasks LIMIT 500"),
  ]);

  const budgetByProject = new Map();
  for (const row of budgetRows) {
    const pid = row.project_id;
    if (pid && !budgetByProject.has(pid)) budgetByProject.set(pid, row);
  }

  const memberCountByProject = new Map();
  for (const row of memberRows) {
    const pid = row.project_id;
    if (!pid) continue;
    memberCountByProject.set(pid, (memberCountByProject.get(pid) ?? 0) + 1);
  }

  const memberLimitByProject = new Map();
  for (const row of limitRows) {
    const pid = row.project_id;
    const cost = Number(row.cost ?? 0);
    if (pid && cost > 0) memberLimitByProject.set(pid, cost);
  }

  const tasksByProject = new Map();
  let tasksDone = 0;
  let tasksTotal = 0;
  for (const row of taskRows) {
    const pid = str(row, "project_id", "projectId");
    const status = str(row, "status") || "todo";
    if (!pid) continue;
    tasksTotal += 1;
    if (status === "done") tasksDone += 1;
    if (!tasksByProject.has(pid)) tasksByProject.set(pid, []);
    tasksByProject.get(pid).push({ status });
  }

  const projects = [];
  let budgetSpentSum = 0;
  let budgetTotalSum = 0;
  let teamMembersSum = 0;
  let activeProjects = 0;
  let onTrack = 0;

  let colorIndex = 0;
  for (const row of projectRows) {
    const id = row.id;
    if (allowed !== null && !allowed.has(id)) continue;
    const status = (str(row, "status") || "active").toLowerCase();
    const isActive = status !== "archived";
    const projectTasks = tasksByProject.get(id) ?? [];
    const done = projectTasks.filter((t) => t.status === "done").length;
    const total = projectTasks.length;
    const health = calculateHealth(status, projectTasks);

    const budgetRow = budgetByProject.get(id);
    const budgetTotal = budgetRow ? num(budgetRow, "cost") : 0;
    const spent = budgetRow && budgetTotal > 0 ? await computeProjectSpentPg(db, id, budgetRow) : 0;
    const budgetType = budgetRow && str(budgetRow, "type") === "Hours based" ? "hours" : "cost";

    const members = memberCountByProject.get(id) ?? 0;
    const memberLimit = memberLimitByProject.get(id) ?? null;

    if (isActive) {
      activeProjects += 1;
      if (health === "on_track") onTrack += 1;
    }
    budgetSpentSum += spent;
    budgetTotalSum += budgetTotal;
    teamMembersSum += members > 0 ? members : 1;

    projects.push({
      id,
      n: str(row, "name") || "Untitled project",
      s: isActive ? "active" : "archived",
      h: health,
      p: { d: done, t: total },
      b: budgetTotal > 0 ? { sp: spent, tot: budgetTotal, ty: budgetType } : null,
      m: members > 0 ? members : 1,
      ml: memberLimit,
      c: colorIndex % 10,
    });
    colorIndex += 1;
  }

  return {
    summary: {
      activeProjects,
      onTrack,
      tasksDone,
      tasksTotal,
      budgetSpent: budgetSpentSum,
      budgetTotal: budgetTotalSum,
      teamMembers: teamMembersSum,
    },
    projects,
  };
}

/**
 * Deferred panels: tasks breakdown, per-project activity, client budgets.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ taskLimit?: number, allowedProjectIds?: Set<string> | null }} [options]
 */
export async function getOverviewPanels(db, options = {}) {
  const taskLimit = Math.min(Math.max(options.taskLimit ?? 80, 1), 200);
  const allowed = options.allowedProjectIds ?? null;

  const [taskRows, projectRows, clientsSnap, budgetsSnap, clientProjectRows, membersSnap] = await Promise.all([
    pgQuery("SELECT id, project_id, status, title, priority, assigned_to FROM tasks LIMIT $1", [taskLimit]),
    pgQuery("SELECT id, name FROM projects LIMIT 200"),
    db.collection("clients").select("status", "name", "email_addresses", "email").limit(100).get(),
    db.collection("client_budgets").select("client_id", "clientId", "cost").limit(100).get(),
    pgQuery("SELECT client_id, project_id FROM client_projects LIMIT 500"),
    db.collection("members").select("first_name", "firstName", "last_name", "lastName", "name").limit(200).get(),
  ]);

  const projectNameById = new Map();
  const projectColorById = new Map();
  let idx = 0;
  for (const row of projectRows) {
    projectNameById.set(row.id, str(row, "name") || "Project");
    projectColorById.set(row.id, idx % 10);
    idx += 1;
  }

  const memberNameById = new Map();
  for (const doc of membersSnap.docs) {
    const row = doc.data() || {};
    const first = str(row, "first_name", "firstName");
    const last = str(row, "last_name", "lastName");
    const name = `${first} ${last}`.trim() || str(row, "name") || "Unknown";
    memberNameById.set(doc.id, name);
  }

  const tasksByProject = new Map();
  const tasks = taskRows.flatMap((row) => {
    const projectId = str(row, "project_id", "projectId");
    if (allowed !== null && projectId && !allowed.has(projectId)) return [];
    const status = str(row, "status") || "todo";
    const item = {
      id: row.id,
      pid: projectId,
      t: str(row, "title") || "Untitled",
      st: status,
      pr: str(row, "priority") || "medium",
      aid: str(row, "assigned_to", "assignedTo") || null,
    };
    if (projectId) {
      if (!tasksByProject.has(projectId)) tasksByProject.set(projectId, []);
      tasksByProject.get(projectId).push({ status });
    }
    return [item];
  });

  const projectActivity = [];
  for (const [pid, list] of tasksByProject) {
    if (allowed !== null && !allowed.has(pid)) continue;
    if (!list.length) continue;
    const counts = { todo: 0, in_progress: 0, in_review: 0, blocked: 0, done: 0 };
    for (const t of list) {
      if (counts[t.status] !== undefined) counts[t.status] += 1;
    }
    const total = list.length;
    projectActivity.push({
      id: pid,
      n: projectNameById.get(pid) ?? "Project",
      c: projectColorById.get(pid) ?? 0,
      td: counts.todo,
      ip: counts.in_progress,
      ir: counts.in_review,
      bl: counts.blocked,
      dn: counts.done,
      tot: total,
    });
  }

  const budgetByClient = new Map();
  for (const doc of budgetsSnap.docs) {
    const row = doc.data() || {};
    const cid = str(row, "client_id", "clientId");
    if (cid && !budgetByClient.has(cid)) {
      budgetByClient.set(cid, num(row, "cost"));
    }
  }

  const projectsByClient = new Map();
  for (const row of clientProjectRows) {
    const cid = row.client_id;
    const pid = row.project_id;
    if (!cid || !pid) continue;
    if (!projectsByClient.has(cid)) projectsByClient.set(cid, []);
    projectsByClient.get(cid).push(pid);
  }

  const clients = clientsSnap.docs
    .map((doc) => {
      const row = doc.data() || {};
      const status = (str(row, "status") || "active").toLowerCase();
      const linkedProjectIds = projectsByClient.get(doc.id) ?? [];
      const scopedProjectIds =
        allowed === null ? linkedProjectIds : linkedProjectIds.filter((pid) => allowed.has(pid));
      const budgetTotal = budgetByClient.get(doc.id) ?? 0;
      const used = budgetTotal > 0 ? Math.round(budgetTotal * 0.6) : 0;
      return {
        id: doc.id,
        n: str(row, "name") || "Client",
        st: status,
        em: str(row, "email_addresses", "email") || "",
        pc: scopedProjectIds.length,
        pids: scopedProjectIds,
        b: budgetTotal > 0 ? { used, tot: budgetTotal } : null,
      };
    })
    .filter((c) => c.st === "active")
    .filter((c) => allowed === null || c.pids.length > 0);

  const assignees = {};
  for (const [id, name] of memberNameById) {
    if (tasks.some((t) => t.aid === id)) assignees[id] = name;
  }

  return { tasks, assignees, projectActivity, clients };
}
