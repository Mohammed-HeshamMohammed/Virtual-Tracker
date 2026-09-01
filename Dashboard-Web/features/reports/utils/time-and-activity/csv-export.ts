import type { TimeActivityDayRow } from "@/features/reports/models/time-and-activity"

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** CSV of the currently displayed (filtered/sorted/grouped) rows — same data
 *  the table shows. groupColumnLabel matches whatever the table's own
 *  leading column is currently labelled (see group-aggregate.ts's
 *  groupByColumnLabel) - "Date" for the default grouping, "Project"/
 *  "Client"/"Member"/"Team"/"Week" for the others. */
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
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
