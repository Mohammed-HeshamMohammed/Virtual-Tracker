import type { TimeActivityDayRow, TimeActivityEntry, TimeActivityGroupBy, TimeActivityMemberSubRow } from "@/features/reports/models/time-and-activity"
import { formatSecondsAsHMS } from "@/features/reports/utils/time-and-activity/row-aggregate"
import type { ActivityLevelFilter, ManualTimeFilter, NameFilter, TrackedTimeFilter } from "@/features/reports/utils/time-and-activity/row-aggregate"
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
  // UTC in, UTC out: `day` is already a calendar string, not a local moment.
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
  memberFilter: NameFilter,
  projectFilter: NameFilter,
  trackedTimeFilter: TrackedTimeFilter,
  manualTimeFilter: ManualTimeFilter = "all",
  activityLevelFilter: ActivityLevelFilter = "all",
): TimeActivityEntry[] {
  return entries.filter((e) => {
    if (memberFilter.length > 0 && !memberFilter.includes(e.memberName)) return false
    if (projectFilter.length > 0 && !projectFilter.includes(e.projectName)) return false
    if (trackedTimeFilter === "with" && e.activeSeconds <= 0) return false
    if (trackedTimeFilter === "without" && e.activeSeconds > 0) return false
    if (manualTimeFilter === "with" && e.manualSeconds <= 0) return false
    if (manualTimeFilter === "without" && e.manualSeconds > 0) return false
    const total = e.activeSeconds + e.idleSeconds
    const activityPct = total > 0 ? Math.round((e.activeSeconds / total) * 100) : 0
    if (activityLevelFilter === "under_50" && activityPct >= 50) return false
    if (activityLevelFilter === "50_to_79" && (activityPct < 50 || activityPct >= 80)) return false
    if (activityLevelFilter === "80_plus" && activityPct < 80) return false
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

/**
 * The people under each day, counting only the given entries.
 *
 * The report's own per-day rows are a member's WHOLE day, whatever they worked
 * on. That is right until the table is narrowed to a project: then a member
 * who spent one hour on it and seven elsewhere still showed eight. Built from
 * the entries instead (one per day, member and project), the day holds only
 * the hours that belong to the projects asked for.
 */
export function buildDayMemberRows(
  entries: TimeActivityEntry[],
  photos: ReadonlyMap<string, string> = new Map(),
): Record<string, TimeActivityMemberSubRow[]> {
  const byDay = new Map<
    string,
    Map<string, { name: string; activeSeconds: number; idleSeconds: number; manualSeconds: number; spentPoints: SpentPoint[]; projects: Set<string> }>
  >()
  for (const e of entries) {
    if (!byDay.has(e.date)) byDay.set(e.date, new Map())
    const members = byDay.get(e.date)!
    if (!members.has(e.memberId)) {
      members.set(e.memberId, { name: e.memberName, activeSeconds: 0, idleSeconds: 0, manualSeconds: 0, spentPoints: [], projects: new Set() })
    }
    const m = members.get(e.memberId)!
    m.activeSeconds += e.activeSeconds
    m.idleSeconds += e.idleSeconds
    m.manualSeconds += e.manualSeconds
    m.spentPoints.push({ amount: e.spentAmount, currency: e.currency })
    if (e.projectName) m.projects.add(e.projectName)
  }
  const out: Record<string, TimeActivityMemberSubRow[]> = {}
  for (const [date, members] of byDay) {
    out[date] = [...members.entries()].map(([memberId, m]) => ({
      memberId,
      name: m.name,
      avatar: initialsFor(m.name),
      avatarUrl: photos.get(memberId) ?? null,
      regularHours: formatSecondsAsHMS(m.activeSeconds),
      totalHours: formatSecondsAsHMS(m.activeSeconds + m.manualSeconds),
      breakTime: "00:00:00",
      activityPct: m.activeSeconds + m.idleSeconds > 0 ? Math.round((m.activeSeconds / (m.activeSeconds + m.idleSeconds)) * 100) : 0,
      idlePct: pctString(m.idleSeconds, m.activeSeconds),
      idleHr: formatSecondsAsHMS(m.idleSeconds),
      totalSpent: sumMoneyByCurrency(m.spentPoints),
      trackedHours: m.activeSeconds / 3600,
      manualHours: m.manualSeconds / 3600,
      projectNames: [...m.projects],
    }))
  }
  return out
}

export function buildGroupedRows(
  entries: TimeActivityEntry[],
  groupBy: TimeActivityGroupBy,
  photos: ReadonlyMap<string, string> = new Map(),
): { rows: TimeActivityDayRow[]; subRowsByKey: Record<string, TimeActivityMemberSubRow[]> } {
  // Under a member or a week the rows beneath are projects (subKeyLabelFor),
  // and a project has no photo.
  const subRowsArePeople = groupBy !== "member" && groupBy !== "date_per_week"
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
      avatarUrl: subRowsArePeople ? (photos.get(s.memberId) ?? null) : undefined,
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

  // Weekly rows: `date` is the ISO week-start key, which sorts chronologically.
  // `dateLabel` ("Jan 5 - Jan 11") does not - alphabetical order scrambles any
  // range spanning more than a couple of months (e.g. puts April before January).
  // Every other grouping mode has no real date in `date` (it's the entity's
  // grouping key), so those keep sorting by the human-readable label instead.
  if (groupBy === "date_per_week") {
    rows.sort((a, b) => a.date.localeCompare(b.date))
  } else {
    rows.sort((a, b) => a.dateLabel.localeCompare(b.dateLabel))
  }
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
