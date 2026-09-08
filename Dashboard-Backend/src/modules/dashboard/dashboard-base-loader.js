
import { logSafeWarn } from "../../http/sanitize-error.js";
import { isPostgresConfigured, query as pgQuery } from "../../lib/postgres/client.js";
import { getSystemMetaDoc, setSystemMetaDoc } from "../../lib/postgres/member-data-store.js";
import { fetchTimeEntriesSinceDate } from "../schema/services/postgres-crud.service.js";
import { fetchPgSessionsForDashboard } from "../../lib/postgres/activity-events-postgres.service.js";
import { listTasksPg } from "../../lib/postgres/tasks-postgres.service.js";
import {
  computeProjectBudgetTargetForAllPg,
  computeProjectSpentForAllPg,
} from "../../lib/postgres/projects-postgres.service.js";
import { getRollingWeekDays } from "./dashboard-utils.js";
import { addLocalDays } from "../../lib/time/timezone-utils.js";

function pgRowsToSerialized(rows) {
  return rows.map((row) => ({ id: row.id, data: row }));
}

const SNAPSHOT_DOC_ID = "dashboard_aggregates";
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MEMORY_TTL_MS = 30_000;
const LARGE_ORG_PROJECT_THRESHOLD = 100;

let memoryCache = null;



function serializeDoc(doc) {
  return { id: doc.id, data: doc.data() || {} };
}

export function pseudoDocsFromSerialized(rows) {
  return rows.map((row) => ({
    id: row.id,
    data: () => row.data,
  }));
}

async function fetchFreshBase(db) {
  // Shared across every viewer, so there is no single "correct" timezone to
  // fetch in - a viewer far enough ahead of UTC (up to +14h) can have their
  // real local Monday start before UTC's Monday does. Fetching from one
  // calendar day earlier than the UTC week start safely covers that (14h <
  // 24h), so per-viewer filtering downstream (getRollingWeekDays(timeZone) in
  // command-center-service.js/general-dashboard-service.js) never has to
  // reach for data this base fetch already excluded.
  const weekDays = getRollingWeekDays();
  const weekStartKey = addLocalDays(weekDays[0].dateKey, -1);

  const [projectRows, budgetRows, projectMemberRows, taskRows] = await Promise.all([
    pgQuery("SELECT id, status, name, updated_at, created_at FROM projects LIMIT 300"),
    pgQuery(
      "SELECT id, project_id, cost, type, based_on, scope, include_non_billable_time, start_date, end_date FROM project_budgets LIMIT 300",
    ),
    pgQuery("SELECT id, project_id, member_id FROM project_members LIMIT 3000"),
    listTasksPg({ limit: 800 }),
  ]);

  const pgRows = await fetchTimeEntriesSinceDate(weekStartKey);
  const timeEntries = pgRows.map((row) => ({
    id: String(row.id ?? ""),
    data: {
      member_id: row.member_id,
      project_id: row.project_id,
      date: row.date,
      duration: row.duration,
      billable: row.billable,
    },
  }));

  const sessionRows = await fetchPgSessionsForDashboard(500);
  const sessions = sessionRows.map((row) => ({
    id: String(row.id ?? ""),
    data: {
      member_id: row.member_id,
      task_id: row.task_id,
      project_id: row.project_id,
      started_at: row.started_at,
      active_seconds: row.active_seconds,
      idle_seconds: row.idle_seconds,
      updated_at: row.updated_at,
      ended_at: row.ended_at,
    },
  }));

  const spentByProject = await computeProjectSpentForAllPg(
    db,
    budgetRows
      .filter((row) => row.project_id)
      .map((row) => ({
        id: String(row.project_id),
        type: row.type,
        based_on: row.based_on,
        include_non_billable_time: row.include_non_billable_time,
        start_date: row.start_date,
        end_date: row.end_date,
      })),
  ).catch((err) => {
    logSafeWarn("[dashboard-base-loader] budget spend computation failed:", err);
    return new Map();
  });
  const targetByProject = await computeProjectBudgetTargetForAllPg(
    db,
    budgetRows
      .filter((row) => row.project_id)
      .map((row) => ({
        id: String(row.project_id),
        scope: row.scope,
        cost: Number(row.cost) || 0,
        type: row.type,
        based_on: row.based_on,
      })),
  ).catch((err) => {
    logSafeWarn("[dashboard-base-loader] per-person budget target failed:", err);
    return new Map();
  });

  const budgetRowsWithSpend = budgetRows.map((row) => {
    const projectId = String(row.project_id);
    return {
      ...row,
      cost: targetByProject.get(projectId) ?? (Number(row.cost) || 0),
      spent: spentByProject.get(projectId) ?? 0,
    };
  });

  return {
    projects: pgRowsToSerialized(projectRows),
    budgets: pgRowsToSerialized(budgetRowsWithSpend),
    projectMembers: pgRowsToSerialized(projectMemberRows),
    tasks: pgRowsToSerialized(taskRows),
    timeEntries,
    sessions,
    projectCount: projectRows.length,
    fetchedAt: Date.now(),
  };
}

function deserializeBase(raw) {
  if (!raw || typeof raw !== "object") return null;
  const toRows = (value) =>
    Array.isArray(value)
      ? value.filter((row) => row && typeof row.id === "string" && row.data && typeof row.data === "object")
      : [];

  const fetchedAt =
    raw.fetched_at?.toDate?.()?.getTime?.() ??
    (typeof raw.fetched_at_ms === "number" ? raw.fetched_at_ms : 0);

  return {
    projects: toRows(raw.projects),
    budgets: toRows(raw.budgets),
    projectMembers: toRows(raw.project_members),
    tasks: toRows(raw.tasks),
    timeEntries: toRows(raw.time_entries),
    sessions: toRows(raw.sessions),
    projectCount: typeof raw.project_count === "number" ? raw.project_count : toRows(raw.projects).length,
    fetchedAt,
  };
}

function serializeBaseForFirestore(base) {
  return {
    projects: base.projects,
    budgets: base.budgets,
    project_members: base.projectMembers,
    tasks: base.tasks,
    time_entries: base.timeEntries,
    sessions: base.sessions,
    project_count: base.projectCount,
    fetched_at: new Date(base.fetchedAt),
    fetched_at_ms: base.fetchedAt,
  };
}

async function persistBaseSnapshot(db, base) {
  if (base.projectCount < LARGE_ORG_PROJECT_THRESHOLD) return;
  await setSystemMetaDoc(db, SNAPSHOT_DOC_ID, serializeBaseForFirestore(base));
}

export async function loadDashboardBase(db) {
  if (memoryCache && memoryCache.base && memoryCache.expiresAt > Date.now()) {
    return memoryCache.base;
  }

  const cachedPayload = await getSystemMetaDoc(db, SNAPSHOT_DOC_ID);
  if (cachedPayload) {
    const cached = deserializeBase(cachedPayload);
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < SNAPSHOT_TTL_MS) {
      memoryCache = { base: cached, expiresAt: Date.now() + MEMORY_TTL_MS };
      return cached;
    }
  }

  const base = await fetchFreshBase(db);
  memoryCache = { base, expiresAt: Date.now() + MEMORY_TTL_MS };
  await persistBaseSnapshot(db, base).catch((err) => {
    logSafeWarn("[dashboard-base-loader] snapshot write failed:", err);
  });
  return base;
}

export function clearDashboardBaseMemoryCache() {
  memoryCache = null;
}
