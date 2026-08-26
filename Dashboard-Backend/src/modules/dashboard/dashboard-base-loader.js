// Shared dashboard aggregates. Snapshotted in system_meta when org has 100+ projects.

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

/** Postgres rows -> the same {id, data} shape serializeDoc() produces for
 * Firestore docs, so every downstream consumer (general-dashboard-service.js,
 * command-center-service.js, via pseudoDocsFromSerialized) keeps working
 * unchanged regardless of which store a given collection actually lives in. */
function pgRowsToSerialized(rows) {
  return rows.map((row) => ({ id: row.id, data: row }));
}

const SNAPSHOT_DOC_ID = "dashboard_aggregates";
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MEMORY_TTL_MS = 30_000;
const LARGE_ORG_PROJECT_THRESHOLD = 100;

/** @type {{ base: DashboardBase | null, expiresAt: number } | null} */
let memoryCache = null;

/**
 * @typedef {object} SerializedDoc
 * @property {string} id
 * @property {Record<string, unknown>} data
 */

/**
 * @typedef {object} DashboardBase
 * @property {SerializedDoc[]} projects
 * @property {SerializedDoc[]} budgets
 * @property {SerializedDoc[]} projectMembers
 * @property {SerializedDoc[]} tasks
 * @property {SerializedDoc[]} timeEntries
 * @property {SerializedDoc[]} sessions
 * @property {number} projectCount
 * @property {number} fetchedAt
 */

/**
 * @param {import("firebase-admin/firestore").QueryDocumentSnapshot | import("firebase-admin/firestore").DocumentSnapshot} doc
 * @returns {SerializedDoc}
 */
function serializeDoc(doc) {
  return { id: doc.id, data: doc.data() || {} };
}

/**
 * @param {SerializedDoc[]} rows
 * @returns {Array<{ id: string, data: () => Record<string, unknown> }>}
 */
export function pseudoDocsFromSerialized(rows) {
  return rows.map((row) => ({
    id: row.id,
    data: () => row.data,
  }));
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @returns {Promise<DashboardBase>}
 */
async function fetchFreshBase(db) {
  const weekDays = getRollingWeekDays();
  const weekStartKey = weekDays[0].dateKey;

  const [projectRows, budgetRows, projectMemberRows, taskRows] = await Promise.all([
    pgQuery("SELECT id, status, name, updated_at, created_at FROM projects LIMIT 300"),
    pgQuery(
      "SELECT id, project_id, cost, type, based_on, scope, include_non_billable_time FROM project_budgets LIMIT 300",
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

  // Real budget spend, same batched computation the Projects Overview page
  // uses. Without this every dashboard budget stat reported 0% forever:
  // budgetSpent() had no field to read but a Firestore-era seed fixture one
  // (_seedBudgetSpentPct), which no Postgres row has ever carried.
  const spentByProject = await computeProjectSpentForAllPg(
    db,
    budgetRows
      .filter((row) => row.project_id)
      .map((row) => ({
        id: String(row.project_id),
        type: row.type,
        based_on: row.based_on,
        include_non_billable_time: row.include_non_billable_time,
      })),
  ).catch((err) => {
    logSafeWarn("[dashboard-base-loader] budget spend computation failed:", err);
    return new Map();
  });
  // scope='per_person' stores hours/cost PER MEMBER, so the real target scales
  // with headcount - the same computation the Projects Overview page uses.
  // Without it a per-person budget read as a fraction of its true size here.
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
      // Effective total for this project, per-person scaling already applied.
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

/**
 * @param {Record<string, unknown>} raw
 * @returns {DashboardBase | null}
 */
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

/**
 * @param {DashboardBase} base
 */
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {DashboardBase} base
 */
async function persistBaseSnapshot(db, base) {
  if (base.projectCount < LARGE_ORG_PROJECT_THRESHOLD) return;
  await setSystemMetaDoc(db, SNAPSHOT_DOC_ID, serializeBaseForFirestore(base));
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @returns {Promise<DashboardBase>}
 */
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

/** Clears in-process cache (tests or admin refresh). */
export function clearDashboardBaseMemoryCache() {
  memoryCache = null;
}
