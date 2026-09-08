
import { getViewerProjectIds } from "../../http/project-access.js";
import { normalizeRoleKey } from "../../http/role-key.js";
import { addLocalDays, localDayFor, localMidnightUtc, weekdayIndexForLocalDay } from "../../lib/time/timezone-utils.js";

export const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function normalizeRole(roleName) {
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

/**
 * Midnight of `date`'s local day, in `timeZone`.
 *
 * `timeZone` defaults to UTC - the container runs with no `TZ` set, so that
 * matches this function's own previous behaviour (`.setHours(0,0,0,0)` on
 * the process's local clock) for any caller not yet passing a real zone.
 * Callers showing a viewer their own "today" should pass that viewer's zone;
 * see `getMemberTimezone`.
 */
export function startOfDay(date = new Date(), timeZone = "UTC") {
  return localMidnightUtc(localDayFor(date, timeZone), timeZone);
}

/**
 * The current Mon-Sun week, in `timeZone`, as day cells consumers already
 * expect (`startMs`/`endMs` as real UTC instants, `dateKey` as the local day
 * string).
 *
 * `startMs`/`endMs` are genuine UTC instants for that local day's boundaries
 * (via `localMidnightUtc`), not a UTC day mislabelled with a local date - the
 * two disagree by the zone's offset, and getting this wrong would silently
 * mis-bucket every session near a day boundary right back into the bug this
 * whole change exists to fix.
 */
export function getRollingWeekDays(timeZone = "UTC") {
  const today = localDayFor(new Date(), timeZone);
  const monday = addLocalDays(today, -weekdayIndexForLocalDay(today));

  return DAY_LABELS.map((label, index) => {
    const dateKey = addLocalDays(monday, index);
    const startMs = localMidnightUtc(dateKey, timeZone).getTime();
    const endMs = localMidnightUtc(addLocalDays(dateKey, 1), timeZone).getTime() - 1;
    return { key: label.toLowerCase(), label, startMs, endMs, dateKey };
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

export async function getMemberProjectIds(db, memberId, roleName) {
  const ids = await getViewerProjectIds(db, memberId, roleName);
  return ids === null ? null : new Set(ids);
}
