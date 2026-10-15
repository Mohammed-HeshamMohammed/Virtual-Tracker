/**
 * Activity in the reports is the screenshots' activity levels, averaged: the same figure
 * the Screenshots, Apps and URLs pages show, so correcting a screenshot's level moves the
 * report too. It used to be active time over tracked time, which measured idleness and
 * matched nothing else on the dashboard.
 *
 * Rows carry a sum of levels and how many screenshots it covers, so any grouping (days
 * into weeks, members into a project) adds them up and still averages correctly.
 */

export interface ActivityTotals {
  activitySum: number
  activityCount: number
}

/** The average level, 0 when there were no screenshots (see activityLabel for display). */
export function activityPercent(sum: number, count: number): number {
  return count > 0 ? Math.round(sum / count) : 0
}

/** "75%", or "-" when no screenshots were taken - which is not the same as 0% activity. */
export function activityLabel(row: { activityPct: number; activityCount: number }): string {
  return row.activityCount > 0 ? `${row.activityPct}%` : "-"
}

export function addActivity(into: ActivityTotals, from: ActivityTotals): void {
  into.activitySum += from.activitySum
  into.activityCount += from.activityCount
}
