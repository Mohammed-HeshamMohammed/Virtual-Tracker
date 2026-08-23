// Project overview aggregates — minimal fields, server-side joins.

import { query as pgQuery } from "../../../lib/postgres/client.js";
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
    // node-postgres returns NUMERIC columns (budget cost, member_limit_cost)
    // as strings, not JS numbers - no setTypeParser is registered anywhere in
    // this backend. Without this, every numeric-string field here silently
    // read back as 0.
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/** "no_tasks" is neutral, not a health verdict - a fresh project with zero
 * tasks has no evidence either way, so it shouldn't inflate the "on track"
 * count. Frontend HEALTH_CONFIG has no entry for it and falls back to a
 * plain "—" (see project-health-grid.tsx). */
function calculateHealth(status, tasksTotal, tasksDone) {
  if (status === "archived") return "stalled";
  if (!tasksTotal) return "no_tasks";
  const progress = tasksDone / tasksTotal;
  if (progress >= 0.7) return "on_track";
  if (progress >= 0.3) return "at_risk";
  return "stalled";
}

// Single indexed query: replaces 5 parallel Firestore-style capped reads
// (200/200/2000/200/500) + in-app Map joins with one Postgres aggregate.
// No arbitrary row ceiling - GROUP BY has no cap by construction.
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
  p.id, p.name, p.status,
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ allowedProjectIds?: Set<string> | null }} [options]
 */
export async function getOverviewCore(db, options = {}) {
  const allowed = options.allowedProjectIds ?? null;
  const allowedArray = allowed !== null ? [...allowed] : null;
  // Summary totals are scoped by `allowed`, same as the per-project rows -
  // they used to be computed org-wide, which meant a restricted viewer saw
  // "Active Projects: 15" above a table listing only the 2 they can see.
  // teamMembers is a separate DISTINCT count (not summed from per-project
  // member_count) because the same person on 2 projects must count once.
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

  // One batched spend computation for every project with a budget, instead
  // of one query (and for cost-based budgets, one Firestore read per member)
  // per project inside the loop below.
  const budgetRowsForSpend = projectRows
    .filter((row) => num(row, "budget_total") > 0)
    .map((row) => ({
      id: row.id,
      type: row.budget_type,
      based_on: row.based_on,
      include_non_billable_time: row.include_non_billable_time,
    }));
  const spentByProject = await computeProjectSpentForAllPg(db, budgetRowsForSpend);

  // scope='per_person' rows store hours-per-member in `cost`, not a total -
  // the real total scales with current headcount (and, for cost-based, each
  // member's own rate). Batched the same way as spend above, not per-project.
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
    const health = calculateHealth(status, total, done);

    const rawBudgetTotal = num(row, "budget_total");
    const hasBudget = rawBudgetTotal > 0;
    // A per-person budget with 0 current members computes a $0 target - that
    // reads as "no budget configured" (the `b: null` gate below), which is
    // wrong: a real per-person rate exists, it just hasn't been multiplied
    // by anyone yet. Fall back to the configured rate itself rather than
    // hiding the budget entirely.
    const budgetTotal =
      hasBudget && row.budget_scope === "per_person"
        ? targetByProject.get(id) || rawBudgetTotal
        : rawBudgetTotal;
    const spent = hasBudget ? spentByProject.get(id) ?? 0 : 0;
    const budgetType = hasBudget && String(row.budget_type) === "Hours based" ? "hours" : "cost";

    const members = Number(row.member_count ?? 0);
    const memberLimit = row.member_limit_cost != null ? Number(row.member_limit_cost) : null;

    if (isActive) {
      activeProjects += 1;
      if (health === "on_track") onTrack += 1;
      tasksTotalSum += total;
      tasksDoneSum += done;
      budgetSpentSum += spent;
      budgetTotalSum += budgetTotal;
    }

    projects.push({
      id,
      n: str(row, "name") || "Untitled project",
      s: isActive ? "active" : "archived",
      h: health,
      p: { d: done, t: total },
      b: budgetTotal > 0 ? { sp: spent, tot: budgetTotal, ty: budgetType } : null,
      // Real member count, including 0 - a "1" fallback here used to make
      // an empty project look staffed both in this row and in the summary
      // Team Members total below.
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

/**
 * Deferred panels: tasks breakdown, per-project activity, client budgets.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ taskLimit?: number, allowedProjectIds?: Set<string> | null }} [options]
 */
export async function getOverviewPanels(db, options = {}) {
  const taskLimit = Math.min(Math.max(options.taskLimit ?? 80, 1), 200);
  const allowed = options.allowedProjectIds ?? null;
  const allowedArray = allowed !== null ? [...allowed] : null;

  const [taskRows, projectRows, clientRows, budgetRows, clientProjectRows, memberRows] = await Promise.all([
    // Scoped + ordered at the SQL level so LIMIT caps the *visible* set, not
    // an arbitrary org-wide slice that a restricted viewer's rows might not
    // even land in (see allowed filter below - this used to run in JS after
    // the LIMIT had already thrown rows away).
    pgQuery(
      `SELECT id, project_id, status, title, priority, assigned_to FROM tasks
       WHERE ($2::uuid[] IS NULL OR project_id = ANY($2::uuid[]))
       ORDER BY created_at DESC LIMIT $1`,
      [taskLimit, allowedArray],
    ),
    // Same ordering as OVERVIEW_CORE_SQL's project list, so colorIndex here
    // lines up with getOverviewCore's - otherwise the same project can get
    // two different colors across panels (and it could change per request,
    // since an unordered query has no stable row order).
    pgQuery("SELECT id, name FROM projects ORDER BY created_at"),
    pgQuery("SELECT id, status, name, email_addresses FROM clients ORDER BY id LIMIT 2000"),
    pgQuery("SELECT client_id, cost FROM client_budgets ORDER BY client_id LIMIT 2000"),
    pgQuery("SELECT client_id, project_id FROM client_projects"),
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
  for (const row of budgetRows) {
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

  // Real spend across each client's linked projects, computed the same way
  // project-level budgets are (computeProjectSpentForAllPg) - this used to
  // be a hard-coded `budgetTotal * 0.6`, i.e. every client's "used" figure
  // was fabricated and had no relationship to actual tracked time/cost.
  const clientLinkedProjectIds = [...new Set(clientProjectRows.map((r) => r.project_id).filter(Boolean))];
  const clientProjectBudgetRows = clientLinkedProjectIds.length
    ? await pgQuery(
        `SELECT project_id, cost, type, based_on, include_non_billable_time
         FROM project_budgets WHERE project_id = ANY($1::uuid[]) AND cost > 0`,
        [clientLinkedProjectIds],
      )
    : [];
  const spentByClientProject = await computeProjectSpentForAllPg(
    db,
    clientProjectBudgetRows.map((r) => ({
      id: r.project_id,
      type: r.type,
      based_on: r.based_on,
      include_non_billable_time: r.include_non_billable_time,
    })),
  );

  const clients = clientRows
    .map((row) => {
      const status = (str(row, "status") || "active").toLowerCase();
      const linkedProjectIds = projectsByClient.get(row.id) ?? [];
      const scopedProjectIds =
        allowed === null ? linkedProjectIds : linkedProjectIds.filter((pid) => allowed.has(pid));
      const budgetTotal = budgetByClient.get(row.id) ?? 0;
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
