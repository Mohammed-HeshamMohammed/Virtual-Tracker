import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE } from "@/features/reports/components/shared/constants"
import type { TimeActivityDayRow, TimeActivityMemberSubRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"

export function parseTimeToSeconds(hms: string): number {
  const parts = hms.split(":").map(Number)
  const h = parts[0] ?? 0
  const m = parts[1] ?? 0
  const s = parts[2] ?? 0
  return h * 3600 + m * 60 + s
}

export function formatSecondsAsHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** Format decimal hours (e.g. 5.25) as HH:MM:SS clock string. */
export function formatDecimalHoursClock(total: number): string {
  const h = Math.floor(total)
  const rem = (total - h) * 3600
  const m = Math.floor(rem / 60)
  const s = Math.floor(rem % 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function aggregateMemberSubRows(subs: TimeActivityMemberSubRow[]): {
  regularHours: string
  breakTime: string
  totalHours: string
  activityPct: number
  idlePct: string
  idleHr: string
  totalSpent: string
  trackedHours: number
  manualHours: number
} {
  if (subs.length === 0) {
    return {
      regularHours: "0:00:00",
      breakTime: "0:00:00",
      totalHours: "0:00:00",
      activityPct: 0,
      idlePct: "-",
      idleHr: "0:00:00",
      totalSpent: "$0.00",
      trackedHours: 0,
      manualHours: 0,
    }
  }
  const regSec = subs.reduce((a, s) => a + parseTimeToSeconds(s.regularHours), 0)
  const breakSec = subs.reduce((a, s) => a + parseTimeToSeconds(s.breakTime), 0)
  const totSec = subs.reduce((a, s) => a + parseTimeToSeconds(s.totalHours), 0)
  const tracked = subs.reduce((a, s) => a + s.trackedHours, 0)
  const manual = subs.reduce((a, s) => a + s.manualHours, 0)
  const activity = Math.round(subs.reduce((a, s) => a + s.activityPct, 0) / subs.length)
  return {
    regularHours: formatSecondsAsHMS(regSec),
    breakTime: formatSecondsAsHMS(breakSec),
    totalHours: formatSecondsAsHMS(totSec),
    activityPct: activity,
    idlePct: subs[0].idlePct,
    idleHr: subs[0].idleHr,
    totalSpent: subs[0].totalSpent,
    trackedHours: tracked,
    manualHours: manual,
  }
}

export type TrackedTimeFilter = "all" | "with" | "without"

export function getFilteredSubRows(
  date: string,
  memberFilter: string,
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  projectFilter: string = ALL_PROJECTS_VALUE,
  trackedTimeFilter: TrackedTimeFilter = "all"
): TimeActivityMemberSubRow[] {
  const rows = memberRows[date] ?? []
  return rows.filter((r) => {
    if (memberFilter !== ALL_MEMBERS_VALUE && r.name !== memberFilter) return false
    if (projectFilter !== ALL_PROJECTS_VALUE && !r.projectNames.includes(projectFilter)) return false
    if (trackedTimeFilter === "with" && r.trackedHours <= 0) return false
    if (trackedTimeFilter === "without" && r.trackedHours > 0) return false
    return true
  })
}

export function buildDisplayDay(
  day: TimeActivityDayRow,
  memberFilter: string,
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  projectFilter: string = ALL_PROJECTS_VALUE,
  trackedTimeFilter: TrackedTimeFilter = "all"
): TimeActivityDayRow {
  if (memberFilter === ALL_MEMBERS_VALUE && projectFilter === ALL_PROJECTS_VALUE && trackedTimeFilter === "all") {
    return day
  }
  const subs = getFilteredSubRows(day.date, memberFilter, memberRows, projectFilter, trackedTimeFilter)
  if (subs.length === 0) {
    return {
      ...day,
      memberCount: 0,
      projectCount: 0,
      regularHours: "0:00:00",
      breakTime: "0:00:00",
      totalHours: "0:00:00",
      activityPct: 0,
      trackedHours: 0,
      manualHours: 0,
    }
  }
  const agg = aggregateMemberSubRows(subs)
  const projectCount = new Set(subs.flatMap((s) => s.projectNames)).size
  return {
    ...day,
    memberCount: subs.length,
    projectCount,
    regularHours: agg.regularHours,
    breakTime: agg.breakTime,
    totalHours: agg.totalHours,
    activityPct: agg.activityPct,
    trackedHours: agg.trackedHours,
    idlePct: agg.idlePct,
    idleHr: agg.idleHr,
    totalSpent: agg.totalSpent,
    manualHours: agg.manualHours,
  }
}

export function getMetricNumeric(metric: TimeActivityMetric, d: TimeActivityDayRow): number {
  switch (metric) {
    case "total_hours":
      return d.trackedHours
    case "activity":
      return d.activityPct
    case "total_spent":
      return Number.parseFloat(d.totalSpent.replace(/[^0-9.-]/g, "")) || 0
    default:
      return 0
  }
}
