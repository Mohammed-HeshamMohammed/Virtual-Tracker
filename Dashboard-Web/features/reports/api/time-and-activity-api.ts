import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { formatSecondsAsHMS } from "@/features/reports/utils/time-and-activity/row-aggregate"
import type { TimeActivityDayRow, TimeActivityEntry, TimeActivityMemberSubRow, TimeActivityReportData } from "@/features/reports/models/time-and-activity"
import { formatMoney, sumMoneyByCurrency } from "@/features/reports/utils/money"

import { toDateParam } from "@/features/reports/utils/time-and-activity/date-range"
import { resolveViewerCurrency } from "@/features/reports/utils/viewer-currency"

interface RawMemberDay {
  memberId: string
  name: string
  avatarUrl?: string | null
  activeSeconds: number
  idleSeconds: number
  manualSeconds?: number
  spentAmount?: number
  currency?: string
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
  currency?: string
  payRate?: number
  payRateCurrency?: string
  billRate?: number
  billRateCurrency?: string
  billAmount?: number
  billCurrency?: string
  billTaxRate?: number
  billNetTermsDays?: number
  billNotes?: string
}

interface RawTimeAndActivityReport {
  days: RawReportDay[]
  entries?: RawEntry[]
  members?: { id: string; name: string; avatarUrl?: string | null }[]
  billingIncluded?: boolean
  currency?: TimeActivityReportData["currency"]
  moneyHidden?: boolean
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

function toMemberSubRow(member: RawMemberDay, photos: Map<string, string>): TimeActivityMemberSubRow {
  const manualSeconds = member.manualSeconds ?? 0
  const regularHours = formatSecondsAsHMS(member.activeSeconds)
  const totalHours = formatSecondsAsHMS(member.activeSeconds + manualSeconds)
  return {
    memberId: member.memberId,
    name: member.name,
    avatar: initialsFor(member.name),
    // The report's own member list first: it carries the profile photo, where
    // the row's field is only the copy on the member record (often empty).
    avatarUrl: photos.get(member.memberId) ?? member.avatarUrl,
    regularHours,
    totalHours,
    breakTime: "00:00:00",
    activityPct: member.activeSeconds + member.idleSeconds > 0
      ? Math.round((member.activeSeconds / (member.activeSeconds + member.idleSeconds)) * 100)
      : 0,
    idlePct: pctString(member.idleSeconds, member.activeSeconds),
    idleHr: formatSecondsAsHMS(member.idleSeconds),
    // Same formatter the day-total row below uses (sumMoneyByCurrency -> formatMoney),
    // so a member row and its own day's total don't render the same currency two
    // different ways ("E£0.00" next to "EGP 1325.86").
    totalSpent: formatMoney(member.spentAmount ?? 0, member.currency ?? "USD"),
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
    // Every member's amount is already in the report's display currency, so
    // this is a plain sum. It used to be a per-currency concatenation, which
    // is what produced "$0.00 + EGP 6.08" in a mixed-currency team.
    totalSpent: sumMoneyByCurrency(day.members.map((m) => ({ amount: m.spentAmount ?? 0, currency: m.currency }))),
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
    spentAmount: raw.spentAmount ?? 0,
    currency: raw.currency || "USD",
    payRate: raw.payRate ?? 0,
    payRateCurrency: raw.payRateCurrency || raw.currency || "USD",
    billRate: raw.billRate,
    billRateCurrency: raw.billRateCurrency,
    billAmount: raw.billAmount,
    billCurrency: raw.billCurrency,
    billTaxRate: raw.billTaxRate,
    billNetTermsDays: raw.billNetTermsDays,
    billNotes: raw.billNotes,
  }
}

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

/** Walks a `YYYY-MM-DD` string forward n days. The Date here is a calendar
 *  cursor anchored at UTC midnight, not a local moment, so it is read back in
 *  UTC - `toDateParam` (which reads local parts) would be wrong. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fillMissingDays(days: TimeActivityDayRow[], range?: { from: string; to: string }): TimeActivityDayRow[] {
  if (!range) return days
  const byDate = new Map(days.map((d) => [d.date, d]))
  const filled: TimeActivityDayRow[] = []
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    filled.push(byDate.get(date) ?? zeroDayRow(date))
    if (filled.length > 3660) break
  }
  return filled
}

function mapReport(raw: RawTimeAndActivityReport, range?: { from: string; to: string }): TimeActivityReportData {
  const days = fillMissingDays(raw.days.map(toDayRow), range)
  const members = raw.members ?? []
  const photos = new Map<string, string>()
  for (const m of members) if (m.avatarUrl) photos.set(m.id, m.avatarUrl)
  const memberRows: Record<string, TimeActivityMemberSubRow[]> = {}
  for (const day of raw.days) {
    memberRows[day.date] = day.members.map((member) => toMemberSubRow(member, photos))
  }
  const entries = (raw.entries ?? []).map(toEntry)
  return {
    days,
    memberRows,
    entries,
    members,
    billingIncluded: raw.billingIncluded === true,
    currency: raw.currency,
    moneyHidden: raw.moneyHidden === true,
  }
}

export async function fetchTimeAndActivityReport(range: {
  from: string
  to: string
  memberId?: string
  displayCurrency?: string
}): Promise<TimeActivityReportData> {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  if (range.memberId) params.set("memberId", range.memberId)
  // The server converts every amount into one currency; this asks for the
  // viewer's own and falls back to the workspace default when there is no rate.
  const viewerCurrency = range.displayCurrency || resolveViewerCurrency()
  if (viewerCurrency) params.set("displayCurrency", viewerCurrency)
  const res = await apiFetch(apiPath(`/api/reports/time-and-activity?${params.toString()}`))
  if (!res.ok) {
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

/** How much a day delete actually removed. All zero means the server found
 *  nothing for that member on that day - the row should not have been there. */
export interface DeletedDayCounts {
  sessions: number
  entries: number
  screenshots: number
  appLogs: number
  urlLogs: number
}

export async function deleteTimeAndActivityDay(memberId: string, date: string): Promise<DeletedDayCounts> {
  const params = new URLSearchParams({ memberId, date })
  const res = await apiFetch(apiPath(`/api/reports/time-and-activity/day?${params.toString()}`), {
    method: "DELETE",
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Failed to delete this day's activity (${res.status}).`)
  }
  const json = (await res.json().catch(() => null)) as { data?: Partial<DeletedDayCounts> } | null
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)
  return {
    sessions: count(json?.data?.sessions),
    entries: count(json?.data?.entries),
    screenshots: count(json?.data?.screenshots),
    appLogs: count(json?.data?.appLogs),
    urlLogs: count(json?.data?.urlLogs),
  }
}
