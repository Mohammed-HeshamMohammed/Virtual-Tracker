import type { ProjectBudgetStatus } from "../types";

/** "Nov 1" for a YYYY-MM-DD day, read as that calendar day wherever the device is. */
function shortDay(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The day after a YYYY-MM-DD day - where the next period starts. */
function dayAfter(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/**
 * When a project's budget starts over, in words for the budget tile - or null for a budget that
 * never does (and for an older server that does not say).
 */
export function budgetResetNote(status: ProjectBudgetStatus | null): string | null {
  if (!status) return null;
  const resets = status.resets ?? "never";
  if (resets === "usedup") {
    return status.remainingSeconds <= 0 ? "Used up - starts over tomorrow" : "Starts over once it's used up";
  }
  if ((resets === "weekly" || resets === "monthly" || resets === "repeat") && status.periodEnd) {
    return `Resets ${shortDay(dayAfter(status.periodEnd))}`;
  }
  return null;
}
