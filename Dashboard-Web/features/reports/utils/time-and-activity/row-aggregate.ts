import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE } from "@/features/reports/components/shared/constants"
import type { TimeActivityDayRow, TimeActivityMemberSubRow, TimeActivityMetric } from "@/features/reports/models/time-and-activity"
import { moneyLabelToNumber, sumMoneyStrings } from "@/features/reports/utils/money"

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
  const idleSec = subs.reduce((a, s) => a + parseTimeToSeconds(s.idleHr), 0)
  const tracked = subs.reduce((a, s) => a + s.trackedHours, 0)
  const manual = subs.reduce((a, s) => a + s.manualHours, 0)
  // Weighted by each member's actual active/idle seconds, not an average of their
  // individual percentages - a member who tracked one minute at 100% shouldn't
  // count as much as one who tracked 8 hours at 60%. regSec is exactly the sum of
  // activeSeconds (regularHours is formatted straight from it in toMemberSubRow),
  // so it doubles as the "active" side of that ratio without recomputing it from
  // the already-summed tracked hours and risking float drift between the two.
  const activityPct = regSec + idleSec > 0 ? Math.round((regSec / (regSec + idleSec)) * 100) : 0
  const idlePct = regSec + idleSec > 0 ? `${Math.round((idleSec / (regSec + idleSec)) * 100)}%` : "-"
  return {
    regularHours: formatSecondsAsHMS(regSec),
    breakTime: formatSecondsAsHMS(breakSec),
    totalHours: formatSecondsAsHMS(totSec),
    activityPct,
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

export function getFilteredSubRows(
  date: string,
  memberFilter: string,
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  projectFilter: string = ALL_PROJECTS_VALUE,
  trackedTimeFilter: TrackedTimeFilter = "all",
  manualTimeFilter: ManualTimeFilter = "all",
  activityLevelFilter: ActivityLevelFilter = "all",
): TimeActivityMemberSubRow[] {
  const rows = memberRows[date] ?? []
  return rows.filter((r) => {
    if (memberFilter !== ALL_MEMBERS_VALUE && r.name !== memberFilter) return false
    if (projectFilter !== ALL_PROJECTS_VALUE && !r.projectNames.includes(projectFilter)) return false
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
  memberFilter: string,
  memberRows: Record<string, TimeActivityMemberSubRow[]>,
  projectFilter: string = ALL_PROJECTS_VALUE,
  trackedTimeFilter: TrackedTimeFilter = "all",
  manualTimeFilter: ManualTimeFilter = "all",
  activityLevelFilter: ActivityLevelFilter = "all",
): TimeActivityDayRow {
  if (
    memberFilter === ALL_MEMBERS_VALUE &&
    projectFilter === ALL_PROJECTS_VALUE &&
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
      // Not a plain digit-strip: a mixed-currency day ("$0.00 + EGP 787.54")
      // would glue the two amounts into one ("0.00787.54") otherwise - the
      // chart plotted a wildly wrong bar for exactly that case.
      return moneyLabelToNumber(d.totalSpent)
    default:
      return 0
  }
}
