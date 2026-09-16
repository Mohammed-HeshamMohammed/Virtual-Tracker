import { addLocalDays } from "../../lib/time/timezone-utils.js";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function seconds(value) {
  return Math.max(0, Math.floor(Number(value ?? 0)) || 0);
}

/**
 * The member's current week, Monday first, one entry per local day.
 *
 * Active time comes from the daily rollup (daily_member_active_seconds) - the
 * same table workedTodaySeconds/workedWeekSeconds sum, so the seven days add up
 * to exactly the "This week" figure. Idle time has no rollup, so it comes from
 * sessions by the local day they started, the same basis as todayActivity.
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
