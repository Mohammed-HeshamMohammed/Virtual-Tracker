import type { WorkSessionGroupBy, WorkSessionRow, WorkSessionScope } from "@/features/reports/models/work-sessions"
import { parseTimeToSeconds } from "@/features/reports/utils/time-and-activity/row-aggregate"

export function formatWorkSessionDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function sessionDayStart(isoDate: string): number {
  const [y, mo, d] = isoDate.split("-").map(Number)
  return new Date(y, mo - 1, d).setHours(0, 0, 0, 0)
}

function inDateRange(isoDate: string, rangeStart: Date, rangeEnd: Date): boolean {
  const t = sessionDayStart(isoDate)
  const a = new Date(rangeStart)
  a.setHours(0, 0, 0, 0)
  const b = new Date(rangeEnd)
  b.setHours(23, 59, 59, 999)
  return t >= a.getTime() && t <= b.getTime()
}

export function filterWorkSessions(
  rows: WorkSessionRow[],
  opts: {
    scope: WorkSessionScope
    rangeStart: Date
    rangeEnd: Date
    projectNames: Set<string> | null
    memberNames: Set<string> | null
    viewerMemberId: string | null
  }
): WorkSessionRow[] {
  const rs = new Date(opts.rangeStart)
  const re = new Date(opts.rangeEnd)
  return rows.filter((r) => {
    if (!inDateRange(r.date, rs, re)) return false
    if (opts.scope === "me" && (!opts.viewerMemberId || r.memberId !== opts.viewerMemberId)) return false
    if (opts.projectNames !== null) {
      if (opts.projectNames.size === 0) return false
      if (!opts.projectNames.has(r.projectName)) return false
    }
    if (opts.memberNames !== null) {
      if (opts.memberNames.size === 0) return false
      if (!opts.memberNames.has(r.memberName)) return false
    }
    return true
  })
}

export function aggregateWorkSessionTotals(rows: WorkSessionRow[]): {
  timeSec: number
  breakSec: number
  avgActivity: number
} {
  let timeSec = 0
  let breakSec = 0
  let actSum = 0
  for (const r of rows) {
    timeSec += parseTimeToSeconds(r.durationHms)
    if (r.breakHms) breakSec += parseTimeToSeconds(r.breakHms)
    actSum += r.activityPct
  }
  const n = rows.length
  const avgActivity = n === 0 ? 0 : Math.round(actSum / n)
  return { timeSec, breakSec, avgActivity }
}

export interface WorkSessionDailyActivityPoint {
  iso: string
  xShort: string
  avgActivity: number
  hasData: boolean
}

function toIsoDateLocal(d: Date): string {
  const y: number = d.getFullYear()
  const m: string = String(d.getMonth() + 1).padStart(2, "0")
  const day: string = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function eachIsoDayInRange(rangeStart: Date, rangeEnd: Date): string[] {
  const out: string[] = []
  const cur: Date = new Date(rangeStart)
  cur.setHours(0, 0, 0, 0)
  const end: Date = new Date(rangeEnd)
  end.setHours(0, 0, 0, 0)
  if (cur.getTime() > end.getTime()) return out
  while (cur.getTime() <= end.getTime()) {
    out.push(toIsoDateLocal(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function buildDailyAvgActivitySeries(
  rows: WorkSessionRow[],
  rangeStart: Date,
  rangeEnd: Date
): WorkSessionDailyActivityPoint[] {
  const days: string[] = eachIsoDayInRange(rangeStart, rangeEnd)
  const byDay: Map<string, WorkSessionRow[]> = new Map()
  for (const r of rows) {
    const list: WorkSessionRow[] | undefined = byDay.get(r.date)
    if (list) list.push(r)
    else byDay.set(r.date, [r])
  }
  return days.map((iso: string) => {
    const list: WorkSessionRow[] = byDay.get(iso) ?? []
    const t = aggregateWorkSessionTotals(list)
    const [y, mo, d] = iso.split("-").map(Number)
    const dt: Date = new Date(y, mo - 1, d)
    const xShort: string = dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    return {
      iso,
      xShort,
      avgActivity: t.avgActivity,
      hasData: list.length > 0,
    }
  })
}

function groupKeyForSession(r: WorkSessionRow, groupBy: WorkSessionGroupBy): string {
  switch (groupBy) {
    case "date":
      return r.date
    case "member":
      return r.memberName
    case "project":
      return r.projectName
    case "client":
      return r.client
    default:
      return r.date
  }
}

function formatGroupHeaderLabel(key: string, groupBy: WorkSessionGroupBy): string {
  if (groupBy === "date" && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split("-").map(Number)
    const dt = new Date(y, m - 1, d)
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
  }
  return key
}

export interface WorkSessionGrouped {
  key: string
  label: string
  rows: WorkSessionRow[]
}

export function groupWorkSessions(rows: WorkSessionRow[], groupBy: WorkSessionGroupBy): WorkSessionGrouped[] {
  const order: string[] = []
  const map = new Map<string, WorkSessionRow[]>()
  for (const r of rows) {
    const k = groupKeyForSession(r, groupBy)
    if (!map.has(k)) {
      map.set(k, [])
      order.push(k)
    }
    map.get(k)!.push(r)
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const da = a.date.localeCompare(b.date)
      if (da !== 0) return da
      return a.startedLabel.localeCompare(b.startedLabel)
    })
  }
  if (groupBy === "date") {
    order.sort((a, b) => a.localeCompare(b))
  }
  return order.map((key) => ({
    key,
    label: formatGroupHeaderLabel(key, groupBy),
    rows: map.get(key) ?? [],
  }))
}

export function exportWorkSessionsToCsv(rows: WorkSessionRow[]): string {
  const headers = [
    "Date",
    "Client",
    "Project",
    "Member",
    "To-do / Job",
    "Manual %",
    "Started",
    "Stopped",
    "Duration",
    "Activity %",
  ]
  const lines = [headers.join(",")]
  for (const r of rows) {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    lines.push(
      [
        r.date,
        r.client,
        r.projectName,
        r.memberName,
        r.todoJob,
        String(r.manualPct),
        r.startedLabel,
        r.stoppedBy ? `${r.stoppedLabel} (${r.stoppedBy})` : r.stoppedLabel,
        r.durationHms,
        String(r.activityPct),
      ]
        .map((c) => esc(String(c)))
        .join(",")
    )
  }
  return lines.join("\n")
}
