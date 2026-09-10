import type { TimeActivityDayRow } from "@/features/reports/models/time-and-activity"

import { todayDateParam } from "@/features/reports/utils/time-and-activity/date-range"
function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildTimeActivityCsv(days: TimeActivityDayRow[], groupColumnLabel = "Date"): string {
  const header = [groupColumnLabel, "Members", "Total hours", "Activity %", "Idle %", "Idle hours", "Total spent"]
  const rows = days.map((d) => [
    d.dateLabel,
    String(d.memberCount),
    d.totalHours,
    `${d.activityPct}%`,
    d.idlePct,
    d.idleHr,
    d.totalSpent,
  ])
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n")
}

export function downloadTimeActivityCsv(days: TimeActivityDayRow[], filename = "time-and-activity", groupColumnLabel = "Date"): void {
  const csv = buildTimeActivityCsv(days, groupColumnLabel)
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename}-${todayDateParam()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
