import type { TimeActivityDayRow } from "@/features/reports/models/time-and-activity"

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** CSV of the currently displayed (filtered/sorted) day rows — same data the table shows. */
export function buildTimeActivityCsv(days: TimeActivityDayRow[]): string {
  const header = ["Date", "Members", "Total hours", "Activity %", "Idle %", "Idle hours", "Total spent"]
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

export function downloadTimeActivityCsv(days: TimeActivityDayRow[], filename = "time-and-activity"): void {
  const csv = buildTimeActivityCsv(days)
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
