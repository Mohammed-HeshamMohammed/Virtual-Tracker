import type { TimeActivityDayRow } from "@/features/reports/models/time-and-activity"

import { parseTimeToSeconds } from "@/features/reports/utils/time-and-activity/row-aggregate"

export function columnVisibleInTable(period: Set<string>, member: Set<string>, key: string): boolean {
  return period.has(key) || member.has(key)
}

function spentUsd(s: string): number {
  return Number.parseFloat(s.replace(/[^0-9.-]/g, "")) || 0
}

export function comparePeriodRows(
  a: TimeActivityDayRow,
  b: TimeActivityDayRow,
  sortKey: string,
  dir: "asc" | "desc"
): number {
  const m = dir === "asc" ? 1 : -1
  switch (sortKey) {
    case "date":
      return m * a.date.localeCompare(b.date)
    case "client":
      return m * a.client.localeCompare(b.client)
    case "team":
      return m * a.team.localeCompare(b.team)
    case "todo":
      return m * a.todo.localeCompare(b.todo)
    case "project":
      return m * (a.projectCount - b.projectCount)
    case "regular_hours":
      return m * (parseTimeToSeconds(a.regularHours) - parseTimeToSeconds(b.regularHours))
    case "break_time":
      return m * (parseTimeToSeconds(a.breakTime) - parseTimeToSeconds(b.breakTime))
    case "manual_hours":
      return m * (a.manualHours - b.manualHours)
    case "total_hours":
      return m * (parseTimeToSeconds(a.totalHours) - parseTimeToSeconds(b.totalHours))
    case "activity_pct":
      return m * (a.activityPct - b.activityPct)
    case "idle_pct": {
      const pa = a.idlePct === "-" ? -1 : Number.parseFloat(a.idlePct)
      const pb = b.idlePct === "-" ? -1 : Number.parseFloat(b.idlePct)
      const na = Number.isFinite(pa) ? pa : -1
      const nb = Number.isFinite(pb) ? pb : -1
      return m * (na - nb)
    }
    case "idle_hr":
      return m * (parseTimeToSeconds(a.idleHr) - parseTimeToSeconds(b.idleHr))
    case "total_spent":
      return m * (spentUsd(a.totalSpent) - spentUsd(b.totalSpent))
    default:
      return 0
  }
}
