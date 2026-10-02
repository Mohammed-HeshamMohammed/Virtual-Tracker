import { addLocalDays } from "../../lib/time/timezone-utils.js";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function seconds(value) {
  return Math.max(0, Math.floor(Number(value ?? 0)) || 0);
}

/**
 * The member's current week, Monday first, one entry per day.
 *
 * Active and idle time both come from the member's sessions, cut at the days of
 * one calendar (the project's when it has one, else the member's own) - the same
 * sessions and the same calendar workedTodaySeconds/workedWeekSeconds and
 * todayActivity use, so the seven days add up to exactly the "This week" figure
 * and today's entry is today's figure.
 * Days with no rows are zero rather than missing, so the week always has seven.
 *
 * @param {string} weekStartDay Monday of the member's week, "YYYY-MM-DD".
 * @param {{ day: string, active_seconds: unknown }[]} activeRows
 * @param {{ day: string, idle_seconds: unknown }[]} idleRows
 */
export function buildWeekDays(weekStartDay, activeRows, idleRows) {
  const active = new Map((activeRows ?? []).map((row) => [String(row.day), seconds(row.active_seconds)]));
  const idle = new Map((idleRows ?? []).map((row) => [String(row.day), seconds(row.idle_seconds)]));
  return LABELS.map((label, index) => {
    const day = addLocalDays(weekStartDay, index);
    return {
      day,
      label,
      activeSeconds: active.get(day) ?? 0,
      idleSeconds: idle.get(day) ?? 0,
    };
  });
}
