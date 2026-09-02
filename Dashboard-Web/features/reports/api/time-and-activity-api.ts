import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { formatSecondsAsHMS } from "@/features/reports/utils/time-and-activity/row-aggregate"
import type { TimeActivityDayRow, TimeActivityEntry, TimeActivityMemberSubRow, TimeActivityReportData } from "@/features/reports/models/time-and-activity"

interface RawMemberDay {
  memberId: string
  name: string
  activeSeconds: number
  idleSeconds: number
  /** Hand-entered time. Optional so an older backend that omits it reads as
   *  0 rather than NaN. Deliberately separate from activeSeconds: manual
   *  time is asserted, not observed, so it must not feed the activity %. */
  manualSeconds?: number
  /** Cost of tracked + manual time; 0 when the viewer may not see this
   *  member's pay rate. */
  spentAmount?: number
  projectNames: string[]
}

interface RawReportDay {
  date: string
  members: RawMemberDay[]
}

interface RawEntry {
  date: string
  memberId: string
  memberName: string
  projectId: string | null
  projectName: string
  clientName: string
  teamName: string
  activeSeconds: number
  idleSeconds: number
  manualSeconds?: number
  spentAmount: number
}

interface RawTimeAndActivityReport {
  days: RawReportDay[]
  /** Absent on an older backend without this field yet - mapReport falls back to []. */
  entries?: RawEntry[]
}

function formatMoney(amount: number | undefined): string {
  return `$${(amount ?? 0).toFixed(2)}`
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0][0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : ""
  return (first + last).toUpperCase() || "?"
}

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function pctString(idleSeconds: number, activeSeconds: number): string {
  const total = idleSeconds + activeSeconds
  if (total <= 0) return "-"
  return `${Math.round((idleSeconds / total) * 100)}%`
}

function toMemberSubRow(member: RawMemberDay): TimeActivityMemberSubRow {
  const manualSeconds = member.manualSeconds ?? 0
  // Regular hours are what was tracked; total adds the hand-entered time on
  // top, which is what makes a manual entry show up against its project at
  // all. activityPct below stays on active/idle only - see manualSeconds.
  const regularHours = formatSecondsAsHMS(member.activeSeconds)
  const totalHours = formatSecondsAsHMS(member.activeSeconds + manualSeconds)
  return {
    name: member.name,
    avatar: initialsFor(member.name),
    regularHours,
    totalHours,
    breakTime: "00:00:00",
    activityPct: member.activeSeconds + member.idleSeconds > 0
      ? Math.round((member.activeSeconds / (member.activeSeconds + member.idleSeconds)) * 100)
      : 0,
    idlePct: pctString(member.idleSeconds, member.activeSeconds),
    idleHr: formatSecondsAsHMS(member.idleSeconds),
    totalSpent: formatMoney(member.spentAmount),
    trackedHours: member.activeSeconds / 3600,
    manualHours: manualSeconds / 3600,
    projectNames: member.projectNames,
  }
}

function toDayRow(day: RawReportDay): TimeActivityDayRow {
  const totalActive = day.members.reduce((sum, m) => sum + m.activeSeconds, 0)
  const totalIdle = day.members.reduce((sum, m) => sum + m.idleSeconds, 0)
  const totalManual = day.members.reduce((sum, m) => sum + (m.manualSeconds ?? 0), 0)
  const projectNames = new Set(day.members.flatMap((m) => m.projectNames))
  const regularHours = formatSecondsAsHMS(totalActive)
  const totalHours = formatSecondsAsHMS(totalActive + totalManual)

  return {
    date: day.date,
    dateLabel: formatDateLabel(day.date),
    memberCount: day.members.length,
    projectCount: projectNames.size,
    client: "",
    team: "",
    todo: "",
    regularHours,
    breakTime: "00:00:00",
    totalHours,
    activityPct: totalActive + totalIdle > 0 ? Math.round((totalActive / (totalActive + totalIdle)) * 100) : 0,
    idlePct: pctString(totalIdle, totalActive),
    idleHr: formatSecondsAsHMS(totalIdle),
    totalSpent: formatMoney(day.members.reduce((sum, m) => sum + (m.spentAmount ?? 0), 0)),
    trackedHours: totalActive / 3600,
    manualHours: totalManual / 3600,
  }
}

function toEntry(raw: RawEntry): TimeActivityEntry {
  return {
    date: raw.date,
    memberId: raw.memberId,
    memberName: raw.memberName,
    projectId: raw.projectId,
    projectName: raw.projectName,
    clientName: raw.clientName,
    teamName: raw.teamName,
    activeSeconds: raw.activeSeconds,
    manualSeconds: raw.manualSeconds ?? 0,
    idleSeconds: raw.idleSeconds,
    spentAmount: raw.spentAmount,
  }
}

/** One all-zero row for a calendar day nobody tracked or logged anything on.
 *  Same shape toDayRow produces for a real day with zero members - a day
 *  with genuinely no activity has to render identically to one that did,
 *  just with nothing in it. */
function zeroDayRow(date: string): TimeActivityDayRow {
  return {
    date,
    dateLabel: formatDateLabel(date),
    memberCount: 0,
    projectCount: 0,
    client: "",
    team: "",
    todo: "",
    regularHours: "00:00:00",
    breakTime: "00:00:00",
    totalHours: "00:00:00",
    activityPct: 0,
    idlePct: pctString(0, 0),
    idleHr: "00:00:00",
    totalSpent: formatMoney(0),
    trackedHours: 0,
    manualHours: 0,
  }
}

/** 'YYYY-MM-DD' + n days, in UTC so this never drifts a day near a local
 *  DST boundary - date-only arithmetic has no timezone to begin with. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The API only ever sends a day that has a real session or manual entry on
 *  it (buildTimeAndActivityReportPayload never emits an empty one) - a
 *  quiet day in the middle of the requested range was simply absent from
 *  `days`, not present with zeros. The table and chart both render exactly
 *  what's in this array with no gap-filling of their own (the date-range
 *  label already had to work around the same sparseness - see this hook's
 *  own `range`-based label fix), so a mostly-quiet range rendered as a
 *  handful of far-apart entries instead of one per day, each mislabeled
 *  with a wrong x-position implied by its array index. Filled here, once,
 *  so the table, the chart and CSV export all inherit a complete series
 *  without each having to know the requested range separately.
 */
function fillMissingDays(days: TimeActivityDayRow[], range?: { from: string; to: string }): TimeActivityDayRow[] {
  if (!range) return days
  const byDate = new Map(days.map((d) => [d.date, d]))
  const filled: TimeActivityDayRow[] = []
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    filled.push(byDate.get(date) ?? zeroDayRow(date))
    // A malformed range (from > to, or either not a real date) must not
    // loop forever - bail once it's clearly not converging.
    if (filled.length > 3660) break
  }
  return filled
}

function mapReport(raw: RawTimeAndActivityReport, range?: { from: string; to: string }): TimeActivityReportData {
  const days = fillMissingDays(raw.days.map(toDayRow), range)
  const memberRows: Record<string, TimeActivityMemberSubRow[]> = {}
  for (const day of raw.days) {
    memberRows[day.date] = day.members.map(toMemberSubRow)
  }
  const entries = (raw.entries ?? []).map(toEntry)
  return { days, memberRows, entries }
}

/** @param range 'YYYY-MM-DD' start/end, inclusive. memberId omitted = every member the viewer can see. */
export async function fetchTimeAndActivityReport(range: {
  from: string
  to: string
  memberId?: string
}): Promise<TimeActivityReportData> {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  if (range.memberId) params.set("memberId", range.memberId)
  const res = await apiFetch(apiPath(`/api/reports/time-and-activity?${params.toString()}`))
  if (!res.ok) {
    // Returning null here made a 403 or a 500 render as an empty report, the
    // same as a range nobody tracked in.
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(
      body?.error ||
        (res.status === 403
          ? "You do not have access to this report."
          : `Report request failed (${res.status}).`),
    )
  }
  const json = await res.json()
  if (!json?.data) throw new Error("The report response was empty.")
  return mapReport(json.data as RawTimeAndActivityReport, { from: range.from, to: range.to })
}

export interface SendTimeAndActivityReportInput {
  from: string
  to: string
  memberId?: string
  emails: string[]
  subject: string
  message: string
  fileType: "csv" | "pdf"
}

export async function sendTimeAndActivityReport(
  input: SendTimeAndActivityReportInput
): Promise<{ sent: number; total: number } | null> {
  try {
    const res = await apiFetch(apiPath("/api/reports/time-and-activity/send"), {
      method: "POST",
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      // The dialog used to report a generic failure for everything, so a
      // rejected address and an unreachable mail service read the same.
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error || "Failed to send the report.")
    }
    const json = await res.json()
    return json.data ?? null
  } catch (err) {
    if (err instanceof Error) throw err
    throw new Error("Failed to send the report.")
  }
}

export interface ScheduleTimeAndActivityReportInput {
  memberId?: string
  emails: string[]
  subject: string
  message: string
  fileType: "csv" | "pdf"
  scheduleName: string
  dateRangeKind: string
  frequency: string
  deliveryTime: string
}

export async function scheduleTimeAndActivityReport(
  input: ScheduleTimeAndActivityReportInput
): Promise<{ id: string } | null> {
  try {
    const res = await apiFetch(apiPath("/api/reports/time-and-activity/schedule"), {
      method: "POST",
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      // The dialog used to report a generic failure for everything, so a
      // rejected address and an unreachable mail service read the same.
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error || "Failed to save the schedule.")
    }
    const json = await res.json()
    return json.data ?? null
  } catch (err) {
    if (err instanceof Error) throw err
    throw new Error("Failed to save the schedule.")
  }
}
