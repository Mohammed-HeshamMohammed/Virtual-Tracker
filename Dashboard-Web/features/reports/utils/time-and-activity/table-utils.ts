import type { TimeActivityDayRow } from "@/features/reports/models/time-and-activity"

import { parseTimeToSeconds } from "@/features/reports/utils/time-and-activity/row-aggregate"

/** `totalSpent` can be "$0.00" or, for a team paid in more than one currency
 *  with no exchange rate to unify them, "$0.00 + EGP 787.54" (sumMoneyByCurrency).
 *  Stripping non-digits from the whole string ran the two numbers together
 *  into one ("0.00787.54"), a number with no relation to either amount - split
 *  on "+" first so each currency's figure is parsed on its own. Sorting a mixed
 *  currency's face value against another currency's is still an approximation
 *  (there's no rate to convert it properly), but it is at least the right
 *  approximation: today's actual total, not two numbers glued together. */
function spentUsd(s: string): number {
  return s
    .split("+")
    .reduce((sum, part) => sum + (Number.parseFloat(part.replace(/[^0-9.-]/g, "")) || 0), 0)
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
