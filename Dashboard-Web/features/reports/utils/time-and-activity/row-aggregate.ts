import type { TimeActivityDayRow, TimeActivityMemberSubRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"
import { moneyLabelToNumber, sumMoneyStrings } from "@/features/reports/utils/money"
import { activityPercent } from "@/features/reports/utils/time-and-activity/activity"

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
  activitySum: number
  activityCount: number
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
      activitySum: 0,
      activityCount: 0,
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
  const idleSec = subs.reduce((a, s) => a + parseTimeToSeconds(s.idleHr), 0)
  const tracked = subs.reduce((a, s) => a + s.trackedHours, 0)
  const manual = subs.reduce((a, s) => a + s.manualHours, 0)
  // Every screenshot counts once, not each member's percentage: a member with one
  // screenshot at 100% must not weigh as much as one with forty at 60%.
  const activitySum = subs.reduce((a, s) => a + s.activitySum, 0)
  const activityCount = subs.reduce((a, s) => a + s.activityCount, 0)
  const activityPct = activityPercent(activitySum, activityCount)
  const idlePct = regSec + idleSec > 0 ? `${Math.round((idleSec / (regSec + idleSec)) * 100)}%` : "-"
  return {
    regularHours: formatSecondsAsHMS(regSec),
    breakTime: formatSecondsAsHMS(breakSec),
    totalHours: formatSecondsAsHMS(totSec),
    activityPct,
    activitySum,
    activityCount,
    idlePct,
    idleHr: formatSecondsAsHMS(idleSec),
    // sumMoneyStrings, not subs[0].totalSpent - the old code silently dropped
    // every member past the first whenever a filter left more than one on the
    // day row, understating idle time and pay together.
    totalSpent: sumMoneyStrings(subs.map((s) => s.totalSpent)),
    trackedHours: tracked,
    manualHours: manual,
  }
}

export type TrackedTimeFilter = "all" | "with" | "without"
export type ManualTimeFilter = "all" | "with" | "without"
export type ActivityLevelFilter = "all" | "under_50" | "50_to_79" | "80_plus"

function matchesActivityLevel(activityPct: number, filter: ActivityLevelFilter): boolean {
  if (filter === "under_50") return activityPct < 50
  if (filter === "50_to_79") return activityPct >= 50 && activityPct < 80
  if (filter === "80_plus") return activityPct >= 80
  return true
}

/** The Members and Projects filters hold the names picked; an empty list is
 *  "all of them", so there is no separate "all" value to keep in step. */
export type NameFilter = readonly string[]

export function getFilteredSubRows(
  date: string,
  memberFilter: NameFilter,
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  projectFilter: NameFilter = [],
  trackedTimeFilter: TrackedTimeFilter = "all",
  manualTimeFilter: ManualTimeFilter = "all",
  activityLevelFilter: ActivityLevelFilter = "all",
): TimeActivityMemberSubRow[] {
  const rows = memberRows[date] ?? []
  return rows.filter((r) => {
    if (memberFilter.length > 0 && !memberFilter.includes(r.name)) return false
    if (projectFilter.length > 0 && !r.projectNames.some((name) => projectFilter.includes(name))) return false
    if (trackedTimeFilter === "with" && r.trackedHours <= 0) return false
    if (trackedTimeFilter === "without" && r.trackedHours > 0) return false
    if (manualTimeFilter === "with" && r.manualHours <= 0) return false
    if (manualTimeFilter === "without" && r.manualHours > 0) return false
    if (!matchesActivityLevel(r.activityPct, activityLevelFilter)) return false
    return true
  })
}

export function buildDisplayDay(
  day: TimeActivityDayRow,
  memberFilter: NameFilter,
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  projectFilter: NameFilter = [],
  trackedTimeFilter: TrackedTimeFilter = "all",
  manualTimeFilter: ManualTimeFilter = "all",
  activityLevelFilter: ActivityLevelFilter = "all",
): TimeActivityDayRow {
  if (
    memberFilter.length === 0 &&
    projectFilter.length === 0 &&
    trackedTimeFilter === "all" &&
    manualTimeFilter === "all" &&
    activityLevelFilter === "all"
  ) {
    return day
  }
  const subs = getFilteredSubRows(
    day.date,
    memberFilter,
    memberRows,
    projectFilter,
    trackedTimeFilter,
    manualTimeFilter,
    activityLevelFilter,
  )
  if (subs.length === 0) {
    return {
      ...day,
      memberCount: 0,
      projectCount: 0,
      regularHours: "0:00:00",
      breakTime: "0:00:00",
      totalHours: "0:00:00",
      activityPct: 0,
      activitySum: 0,
      activityCount: 0,
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
    activitySum: agg.activitySum,
    activityCount: agg.activityCount,
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
      // Not a plain digit-strip: a mixed-currency day ("$0.00 + EGP 787.54")
      // would glue the two amounts into one ("0.00787.54") otherwise - the
      // chart plotted a wildly wrong bar for exactly that case.
      return moneyLabelToNumber(d.totalSpent)
    default:
      return 0
  }
}
