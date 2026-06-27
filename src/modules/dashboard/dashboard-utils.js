/** Shared helpers for dashboard aggregation services. */

export const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function getMemberProjectIds(db, memberId) {
  const ids = new Set();
  const pmSnap = await db.collection("project_members").where("member_id", "==", memberId).limit(200).get();
  for (const doc of pmSnap.docs) {
    const pid = str(doc.data(), "project_id", "projectId");
    if (pid) ids.add(pid);
  }
  const memberDoc = await db.collection("members").doc(memberId).get();
  if (memberDoc.exists) {
    for (const pid of memberDoc.data()?.projects || []) {
      if (pid) ids.add(String(pid));
    }
  }
  return ids;
}
