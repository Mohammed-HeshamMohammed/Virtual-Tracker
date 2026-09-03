import { ALL_MEMBERS_VALUE, ALL_PROJECTS_VALUE } from "@/features/reports/components/shared/constants"
import type { TimeActivityDayRow, TimeActivityEntry, TimeActivityGroupBy, TimeActivityMemberSubRow } from "@/features/reports/models/time-and-activity"
import { formatSecondsAsHMS } from "@/features/reports/utils/time-and-activity/row-aggregate"
import type { TrackedTimeFilter } from "@/features/reports/utils/time-and-activity/row-aggregate"
import { sumMoneyByCurrency } from "@/features/reports/utils/money"

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0][0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : ""
  return (first + last).toUpperCase() || "?"
}

function pctString(idleSeconds: number, activeSeconds: number): string {
  const total = idleSeconds + activeSeconds
  if (total <= 0) return "-"
  return `${Math.round((idleSeconds / total) * 100)}%`
}

function isoWeekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const dow = d.getUTCDay()
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + mondayOffset)
  return d.toISOString().slice(0, 10)
}

function weekLabel(weekStartKey: string): string {
  const start = new Date(`${weekStartKey}T00:00:00Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `${fmt(start)} - ${fmt(end)}`
}

export function filterEntries(
  entries: TimeActivityEntry[],
  memberFilter: string,
  projectFilter: string,
  trackedTimeFilter: TrackedTimeFilter
): TimeActivityEntry[] {
  return entries.filter((e) => {
    if (memberFilter !== ALL_MEMBERS_VALUE && e.memberName !== memberFilter) return false
    if (projectFilter !== ALL_PROJECTS_VALUE && e.projectName !== projectFilter) return false
    if (trackedTimeFilter === "with" && e.activeSeconds <= 0) return false
    if (trackedTimeFilter === "without" && e.activeSeconds > 0) return false
    return true
  })
}

type SpentPoint = { amount: number; currency: string }

type Bucket = {
  label: string
  activeSeconds: number
  idleSeconds: number
  manualSeconds: number
  spentPoints: SpentPoint[]
  memberIds: Set<string>
  projectIds: Set<string>
  sub: Map<
    string,
    {
      memberId: string
      label: string
      activeSeconds: number
      idleSeconds: number
      manualSeconds: number
      spentPoints: SpentPoint[]
    }
  >
}

function keyLabelFor(mode: "member" | "project" | "client" | "team", e: TimeActivityEntry): [string, string] {
  switch (mode) {
    case "member":
      return [e.memberId, e.memberName]
    case "project":
      return [e.projectId ?? "none", e.projectName || "No project"]
    case "client":
      return [e.clientName || "none", e.clientName || "No client"]
    case "team":
      return [e.teamName || "none", e.teamName || "No team"]
  }
}

function subKeyLabelFor(mode: "member" | "project" | "client" | "team", e: TimeActivityEntry): [string, string] {
  if (mode === "member") return [e.projectId ?? "none", e.projectName || "No project"]
  return [e.memberId, e.memberName]
}

export function buildGroupedRows(
  entries: TimeActivityEntry[],
  groupBy: TimeActivityGroupBy
): { rows: TimeActivityDayRow[]; subRowsByKey: Record<string, TimeActivityMemberSubRow[]> } {
  const buckets = new Map<string, Bucket>()

  function addTo(key: string, label: string, e: TimeActivityEntry, subKey: string, subLabel: string) {
    if (!buckets.has(key)) {
      buckets.set(key, { label, activeSeconds: 0, idleSeconds: 0, manualSeconds: 0, spentPoints: [], memberIds: new Set(), projectIds: new Set(), sub: new Map() })
    }
    const b = buckets.get(key)!
    b.activeSeconds += e.activeSeconds
    b.idleSeconds += e.idleSeconds
    b.manualSeconds += e.manualSeconds
    b.spentPoints.push({ amount: e.spentAmount, currency: e.currency })
    b.memberIds.add(e.memberId)
    if (e.projectId) b.projectIds.add(e.projectId)
    if (!b.sub.has(subKey))
      b.sub.set(subKey, { memberId: e.memberId, label: subLabel, activeSeconds: 0, idleSeconds: 0, manualSeconds: 0, spentPoints: [] })
    const s = b.sub.get(subKey)!
    s.activeSeconds += e.activeSeconds
    s.idleSeconds += e.idleSeconds
    s.manualSeconds += e.manualSeconds
    s.spentPoints.push({ amount: e.spentAmount, currency: e.currency })
  }

  for (const e of entries) {
    if (groupBy === "date_per_week") {
      const key = isoWeekStart(e.date)
      const [subKey, subLabel] = subKeyLabelFor("member", e)
      addTo(key, weekLabel(key), e, subKey, subLabel)
      continue
    }
    if (groupBy === "date_per_day") continue
    const [key, label] = keyLabelFor(groupBy, e)
    const [subKey, subLabel] = subKeyLabelFor(groupBy, e)
    addTo(key, label, e, subKey, subLabel)
  }

  const rows: TimeActivityDayRow[] = []
  const subRowsByKey: Record<string, TimeActivityMemberSubRow[]> = {}

  for (const [key, b] of buckets.entries()) {
    const totalHours = formatSecondsAsHMS(b.activeSeconds)
    rows.push({
      date: key,
      dateLabel: b.label,
      memberCount: b.memberIds.size,
      projectCount: b.projectIds.size,
      client: groupBy === "client" ? b.label : "",
      team: groupBy === "team" ? b.label : "",
      todo: "",
      regularHours: totalHours,
      breakTime: "00:00:00",
      totalHours: formatSecondsAsHMS(b.activeSeconds + b.manualSeconds),
      activityPct:
        b.activeSeconds + b.idleSeconds > 0 ? Math.round((b.activeSeconds / (b.activeSeconds + b.idleSeconds)) * 100) : 0,
      idlePct: pctString(b.idleSeconds, b.activeSeconds),
      idleHr: formatSecondsAsHMS(b.idleSeconds),
      totalSpent: sumMoneyByCurrency(b.spentPoints),
      trackedHours: b.activeSeconds / 3600,
      manualHours: b.manualSeconds / 3600,
    })
    subRowsByKey[key] = [...b.sub.entries()].map(([, s]) => ({
      memberId: s.memberId,
      name: s.label,
      avatar: initialsFor(s.label),
      regularHours: formatSecondsAsHMS(s.activeSeconds),
      totalHours: formatSecondsAsHMS(s.activeSeconds + s.manualSeconds),
      breakTime: "00:00:00",
      activityPct:
        s.activeSeconds + s.idleSeconds > 0 ? Math.round((s.activeSeconds / (s.activeSeconds + s.idleSeconds)) * 100) : 0,
      idlePct: pctString(s.idleSeconds, s.activeSeconds),
      idleHr: formatSecondsAsHMS(s.idleSeconds),
      totalSpent: sumMoneyByCurrency(s.spentPoints),
      trackedHours: s.activeSeconds / 3600,
      manualHours: s.manualSeconds / 3600,
      projectNames: [],
    }))
  }

  rows.sort((a, b) => a.dateLabel.localeCompare(b.dateLabel))
  return { rows, subRowsByKey }
}

export function groupByColumnLabel(groupBy: TimeActivityGroupBy): string {
  switch (groupBy) {
    case "date_per_day":
      return "Date"
    case "date_per_week":
      return "Week"
    case "member":
      return "Member"
    case "project":
      return "Project"
    case "client":
      return "Client"
    case "team":
      return "Team"
  }
}
