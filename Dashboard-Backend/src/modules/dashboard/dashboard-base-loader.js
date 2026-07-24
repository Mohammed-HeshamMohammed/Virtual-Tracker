// Shared dashboard aggregates. Snapshotted in system_meta when org has 100+ projects.

import { logSafeWarn } from "../../http/sanitize-error.js";
import { COLLECTIONS } from "../../lib/firestore/collections.js";
import { isPostgresConfigured } from "../../lib/postgres/client.js";
import { getSystemMetaDoc, setSystemMetaDoc } from "../../lib/postgres/member-data-store.js";
import { fetchTimeEntriesSinceDate } from "../schema/services/postgres-crud.service.js";
import { fetchPgSessionsForDashboard } from "../../lib/postgres/activity-events-postgres.service.js";
import { getRollingWeekDays } from "./dashboard-utils.js";

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

  const [projectsSnap, budgetsSnap, projectMembersSnap, tasksSnap] = await Promise.all([
      db.collection(COLLECTIONS.projects).select("status", "name", "updated_at", "created_at").limit(300).get(),
      db
        .collection("project_budgets")
        .select("project_id", "projectId", "cost", "seedBudgetSpentPct", "_seedBudgetSpentPct")
        .limit(300)
        .get(),
      db.collection("project_members").select("project_id", "projectId", "member_id", "memberId").limit(3000).get(),
      db
        .collection("tasks")
        .select(
          "project_id",
          "projectId",
          "status",
          "title",
          "priority",
          "assigned_to",
          "assignedTo",
          "updated_at",
          "updatedAt",
          "created_at",
          "createdAt",
        )
        .limit(800)
        .get(),
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
      started_at: row.started_at,
      active_seconds: row.active_seconds,
      idle_seconds: row.idle_seconds,
      updated_at: row.updated_at,
      ended_at: row.ended_at,
    },
  }));

  return {
    projects: projectsSnap.docs.map(serializeDoc),
    budgets: budgetsSnap.docs.map(serializeDoc),
    projectMembers: projectMembersSnap.docs.map(serializeDoc),
    tasks: tasksSnap.docs.map(serializeDoc),
    timeEntries,
    sessions,
    projectCount: projectsSnap.size,
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
