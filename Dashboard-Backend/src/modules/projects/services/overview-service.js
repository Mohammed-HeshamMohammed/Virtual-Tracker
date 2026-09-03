
import { query as pgQuery } from "../../../lib/postgres/client.js";
import { isTaskLessProjectType } from "../project-types.js";
import {
  computeProjectSpentForAllPg,
  computeProjectBudgetTargetForAllPg,
} from "../../../lib/postgres/projects-postgres.service.js";

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
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

function calculateHealth(status, tasksTotal, tasksDone) {
  if (status === "archived") return "stalled";
  if (!tasksTotal) return "no_tasks";
  const progress = tasksDone / tasksTotal;
  if (progress >= 0.7) return "on_track";
  if (progress >= 0.3) return "at_risk";
  return "stalled";
}

function calculateBudgetHealth(status, spent, budgetTotal) {
  if (status === "archived") return "stalled";
  if (!(budgetTotal > 0)) return "no_tasks";
  const usedRatio = spent / budgetTotal;
  if (usedRatio >= 1) return "stalled";
  if (usedRatio >= 0.85) return "at_risk";
  return "on_track";
}

const OVERVIEW_CORE_SQL = `
WITH task_counts AS (
  SELECT project_id,
    COUNT(*) AS tasks_total,
    COUNT(*) FILTER (WHERE status = 'done') AS tasks_done
  FROM tasks
  GROUP BY project_id
),
member_counts AS (
  SELECT project_id, COUNT(*) AS member_count
  FROM project_members
  GROUP BY project_id
),
member_limit_agg AS (
  SELECT project_id, MAX(cost) FILTER (WHERE cost > 0) AS member_limit_cost
  FROM project_member_limits
  GROUP BY project_id
)
SELECT
  p.id, p.name, p.status, p.type,
  COALESCE(tc.tasks_total, 0) AS tasks_total,
  COALESCE(tc.tasks_done, 0)  AS tasks_done,
  COALESCE(mc.member_count, 0) AS member_count,
  pb.cost AS budget_total,
  pb.type AS budget_type,
  pb.based_on,
  pb.scope AS budget_scope,
  pb.include_non_billable_time,
  mla.member_limit_cost
FROM projects p
LEFT JOIN task_counts     tc  ON tc.project_id = p.id
LEFT JOIN member_counts   mc  ON mc.project_id = p.id
LEFT JOIN project_budgets pb  ON pb.project_id = p.id
LEFT JOIN member_limit_agg mla ON mla.project_id = p.id
WHERE ($1::uuid[] IS NULL OR p.id = ANY($1::uuid[]))
ORDER BY p.created_at`;

export async function getOverviewCore(db, options = {}) {
  const allowed = options.allowedProjectIds ?? null;
  const allowedArray = allowed !== null ? [...allowed] : null;
  const [projectRows, [teamMembersRow]] = await Promise.all([
    pgQuery(OVERVIEW_CORE_SQL, [allowedArray]),
    pgQuery(
      `SELECT COUNT(DISTINCT pm.member_id)::int AS n
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE p.status != 'archived'
         AND ($1::uuid[] IS NULL OR p.id = ANY($1::uuid[]))`,
      [allowedArray],
    ),
  ]);

  const budgetRowsForSpend = projectRows
    .filter((row) => num(row, "budget_total") > 0)
    .map((row) => ({
      id: row.id,
      type: row.budget_type,
      based_on: row.based_on,
      include_non_billable_time: row.include_non_billable_time,
      start_date: row.start_date,
      end_date: row.end_date,
    }));
  const spentByProject = await computeProjectSpentForAllPg(db, budgetRowsForSpend);

  const budgetRowsForTarget = projectRows
    .filter((row) => num(row, "budget_total") > 0 && row.budget_scope === "per_person")
    .map((row) => ({
      id: row.id,
      type: row.budget_type,
      based_on: row.based_on,
      scope: row.budget_scope,
      cost: num(row, "budget_total"),
    }));
  const targetByProject = await computeProjectBudgetTargetForAllPg(db, budgetRowsForTarget);

  const projects = [];
  let budgetSpentSum = 0;
  let budgetTotalSum = 0;
  let tasksDoneSum = 0;
  let tasksTotalSum = 0;
  let activeProjects = 0;
  let onTrack = 0;

  let colorIndex = 0;
  for (const row of projectRows) {
    const id = row.id;
    const status = (str(row, "status") || "active").toLowerCase();
    const isActive = status !== "archived";
    const total = Number(row.tasks_total ?? 0);
    const done = Number(row.tasks_done ?? 0);

    const rawBudgetTotal = num(row, "budget_total");
    const hasBudget = rawBudgetTotal > 0;
    const budgetTotal =
      hasBudget && row.budget_scope === "per_person"
        ? targetByProject.get(id) || rawBudgetTotal
        : rawBudgetTotal;
    const spent = hasBudget ? spentByProject.get(id) ?? 0 : 0;
    const budgetType = hasBudget && String(row.budget_type) === "Hours based" ? "hours" : "cost";

    const health = hasBudget
      ? calculateBudgetHealth(status, spent, budgetTotal)
      : calculateHealth(status, total, done);
    const progress = hasBudget ? { d: Math.round(spent), t: Math.round(budgetTotal) } : { d: done, t: total };

    const members = Number(row.member_count ?? 0);
    const memberLimit = row.member_limit_cost != null ? Number(row.member_limit_cost) : null;

    if (isActive) {
      activeProjects += 1;
      if (health === "on_track") onTrack += 1;
      const taskLess = isTaskLessProjectType(str(row, "type"));
      const virtualTotal = taskLess ? 1 : total;
      const virtualDone = taskLess ? (hasBudget && spent / budgetTotal >= 1 ? 1 : 0) : done;
      tasksTotalSum += virtualTotal;
      tasksDoneSum += virtualDone;
      budgetSpentSum += spent;
      budgetTotalSum += budgetTotal;
    }

    projects.push({
      id,
      n: str(row, "name") || "Untitled project",
      s: isActive ? "active" : "archived",
      h: health,
      p: progress,
      b: budgetTotal > 0 ? { sp: spent, tot: budgetTotal, ty: budgetType } : null,
      m: members,
      ml: memberLimit,
      c: colorIndex % 10,
    });
    colorIndex += 1;
  }

  return {
    summary: {
      activeProjects,
      onTrack,
      tasksDone: tasksDoneSum,
      tasksTotal: tasksTotalSum,
      budgetSpent: budgetSpentSum,
      budgetTotal: budgetTotalSum,
      teamMembers: teamMembersRow?.n ?? 0,
    },
    projects,
  };
}

export async function getOverviewPanels(db, options = {}) {
  const taskLimit = Math.min(Math.max(options.taskLimit ?? 80, 1), 200);
  const allowed = options.allowedProjectIds ?? null;
  const allowedArray = allowed !== null ? [...allowed] : null;
  const includeClientBudgets = options.includeClientBudgets === true;

  const [taskRows, projectRows, clientRows, clientProjectRows, memberRows] = await Promise.all([
    pgQuery(
      `SELECT id, project_id, status, title, priority, assigned_to FROM tasks
       WHERE ($2::uuid[] IS NULL OR project_id = ANY($2::uuid[]))
       ORDER BY created_at DESC LIMIT $1`,
      [taskLimit, allowedArray],
    ),
    pgQuery(
      `SELECT p.id, p.name, pb.cost AS budget_total, pb.type AS budget_type,
              pb.based_on, pb.scope AS budget_scope, pb.include_non_billable_time, pb.start_date, pb.end_date
       FROM projects p
       LEFT JOIN project_budgets pb ON pb.project_id = p.id
       ORDER BY p.created_at`,
    ),
    includeClientBudgets ? pgQuery("SELECT id, status, name, email_addresses FROM clients ORDER BY id LIMIT 2000") : [],
    includeClientBudgets ? pgQuery("SELECT client_id, project_id FROM client_projects") : [],
    pgQuery("SELECT id, first_name, last_name, display_name FROM members ORDER BY id"),
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
  for (const row of memberRows) {
    const first = str(row, "first_name");
    const last = str(row, "last_name");
    const full = `${first} ${last}`.trim() || str(row, "display_name") || "Member";
    memberNameById.set(row.id, full);
  }

  const budgetedProjectRows = projectRows.filter((row) => num(row, "budget_total") > 0);
  const [spentByProject, targetByProject] = await Promise.all([
    computeProjectSpentForAllPg(
      db,
      budgetedProjectRows.map((row) => ({
        id: row.id,
        type: row.budget_type,
        based_on: row.based_on,
        include_non_billable_time: row.include_non_billable_time,
        start_date: row.start_date,
        end_date: row.end_date,
      })),
    ),
    computeProjectBudgetTargetForAllPg(
      db,
      budgetedProjectRows
        .filter((row) => row.budget_scope === "per_person")
        .map((row) => ({
          id: row.id,
          type: row.budget_type,
          based_on: row.based_on,
          scope: row.budget_scope,
          cost: num(row, "budget_total"),
        })),
    ),
  ]);
  const projectBudgetById = new Map();
  for (const row of budgetedProjectRows) {
    const raw = num(row, "budget_total");
    const tot = row.budget_scope === "per_person" ? targetByProject.get(row.id) || raw : raw;
    if (tot > 0) projectBudgetById.set(row.id, { sp: spentByProject.get(row.id) ?? 0, tot });
  }

  const tasksByProject = new Map();
  const tasks = taskRows.map((row) => {
    const projectId = str(row, "project_id", "projectId");
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
    return item;
  });

  const projectActivity = [];
  const projectsWithActivity = new Set();
  for (const [pid, list] of tasksByProject) {
    if (allowed !== null && !allowed.has(pid)) continue;
    if (!list.length) continue;
    projectsWithActivity.add(pid);
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
      b: projectBudgetById.get(pid) ?? null,
    });
  }
  for (const row of projectRows) {
    const pid = row.id;
    if (projectsWithActivity.has(pid)) continue;
    if (allowed !== null && !allowed.has(pid)) continue;
    const budget = projectBudgetById.get(pid);
    if (!budget) continue;
    projectActivity.push({
      id: pid,
      n: projectNameById.get(pid) ?? "Project",
      c: projectColorById.get(pid) ?? 0,
      td: 0,
      ip: 0,
      ir: 0,
      bl: 0,
      dn: 0,
      tot: 0,
      b: budget,
    });
  }

  const projectsByClient = new Map();
  for (const row of clientProjectRows) {
    const cid = row.client_id;
    const pid = row.project_id;
    if (!cid || !pid) continue;
    if (!projectsByClient.has(cid)) projectsByClient.set(cid, []);
    projectsByClient.get(cid).push(pid);
  }

  const clientLinkedProjectIds = [...new Set(clientProjectRows.map((r) => r.project_id).filter(Boolean))];
  const clientProjectBudgetRows = clientLinkedProjectIds.length
    ? await pgQuery(
        `SELECT project_id, cost, type, based_on, scope, include_non_billable_time, start_date, end_date
         FROM project_budgets WHERE project_id = ANY($1::uuid[]) AND cost > 0`,
        [clientLinkedProjectIds],
      )
    : [];
  const [spentByClientProject, targetByClientProject] = await Promise.all([
    computeProjectSpentForAllPg(
      db,
      clientProjectBudgetRows.map((r) => ({
        id: r.project_id,
        type: r.type,
        based_on: r.based_on,
        include_non_billable_time: r.include_non_billable_time,
        start_date: r.start_date,
        end_date: r.end_date,
      })),
    ),
    computeProjectBudgetTargetForAllPg(
      db,
      clientProjectBudgetRows
        .filter((r) => r.scope === "per_person")
        .map((r) => ({ id: r.project_id, type: r.type, based_on: r.based_on, scope: r.scope, cost: num(r, "cost") })),
    ),
  ]);
  const budgetTotalByProject = new Map(
    clientProjectBudgetRows.map((r) => [
      r.project_id,
      r.scope === "per_person" ? targetByClientProject.get(r.project_id) || num(r, "cost") : num(r, "cost"),
    ]),
  );

  const clients = clientRows
    .map((row) => {
      const status = (str(row, "status") || "active").toLowerCase();
      const linkedProjectIds = projectsByClient.get(row.id) ?? [];
      const scopedProjectIds =
        allowed === null ? linkedProjectIds : linkedProjectIds.filter((pid) => allowed.has(pid));
      const budgetTotal = linkedProjectIds.reduce((sum, pid) => sum + (budgetTotalByProject.get(pid) ?? 0), 0);
      const used = linkedProjectIds.reduce((sum, pid) => sum + (spentByClientProject.get(pid) ?? 0), 0);
      return {
        id: row.id,
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
