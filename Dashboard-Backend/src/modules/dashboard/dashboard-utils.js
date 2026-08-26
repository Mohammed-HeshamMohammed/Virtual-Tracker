/** Shared helpers for dashboard aggregation services. */

import { getViewerProjectIds } from "../../http/project-access.js";
import { normalizeRoleKey } from "../../http/role-key.js";

export const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function normalizeRole(roleName) {
  // Delegates to the canonical normalizer - a local copy here would
  // drop the legacy-misspelling fold and silently mis-rank "Super Manger".
  return normalizeRoleKey(roleName);
}

export function str(row, ...keys) {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function num(row, ...keys) {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    // node-postgres returns NUMERIC and BIGINT columns as strings - no
    // setTypeParser is registered anywhere in this backend. Without this
    // branch every numeric-string field read back as 0, which is why the
    // Command Center reported "No Budget" and 0% progress while the Projects
    // Overview page (whose own num() already handles this) showed real
    // figures from the very same project_budgets.cost column.
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

export function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

export function toIso(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getRollingWeekDays() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = startOfDay(now);
  monday.setDate(now.getDate() + mondayOffset);

  return DAY_LABELS.map((label, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const startMs = date.getTime();
    return {
      key: label.toLowerCase(),
      label,
      startMs,
      endMs: startMs + 86_400_000 - 1,
      dateKey: date.toISOString().slice(0, 10),
    };
  });
}

export function buildTrendPaths(values) {
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

export function budgetSpent(total, row) {
  // `spent` is the real figure, computed by computeProjectSpentForAllPg in
  // dashboard-base-loader.js (same source the Projects Overview page uses).
  // The _seedBudgetSpentPct fallback below is a Firestore-era demo fixture
  // field; it was the ONLY thing read here, so every dashboard budget stat
  // sat at 0% for any real org.
  const spent = num(row, "spent");
  if (spent > 0) return spent;
  const pct = num(row, "_seedBudgetSpentPct", "seedBudgetSpentPct");
  if (pct > 0 && total > 0) return Math.round(total * Math.min(pct, 1));
  return 0;
}

export function calculateHealth(status, tasksForProject) {
  if (status === "archived") return "stalled";
  if (!tasksForProject.length) return "on_track";
  const done = tasksForProject.filter((t) => t.status === "done").length;
  const progress = done / tasksForProject.length;
  if (progress >= 0.7) return "on_track";
  if (progress >= 0.3) return "at_risk";
  return "stalled";
}

/**
 * Projects a dashboard viewer may see, or null for "every project".
 *
 * This used to read project_members directly and hand back null only for the
 * Owner, so a Super Admin, Admin or Super Manager - none of whom are normally
 * rows in project_members - resolved to an empty set and got "No projects yet"
 * on a fully populated org. It also missed projects the viewer created without
 * a membership row (createProjectPg only stamps created_by). getViewerProjectIds
 * is the codebase's answer to both, and is what every other project-scoped
 * endpoint already uses; the dashboards were the outlier.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @returns {Promise<Set<string> | null>}
 */
export async function getMemberProjectIds(db, memberId, roleName) {
  const ids = await getViewerProjectIds(db, memberId, roleName);
  return ids === null ? null : new Set(ids);
}
