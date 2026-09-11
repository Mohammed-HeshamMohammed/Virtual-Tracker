import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { AmountsOwedDayGroup } from "@/features/reports/components/shared/constants"
import type { AuditLogRow } from "@/features/reports/models/audit-log"
import type { WorkSessionRow } from "@/features/reports/models/work-sessions"
import type { ProjectBudgetSection, ProjectBudgetRow } from "@/features/reports/models/project-budgets"
import type { ClientBudgetRow } from "@/features/reports/models/client-budgets"
import type { LimitPeriodRow, LimitUsageRow } from "@/features/reports/models/limits"
import type { TimesheetApprovalRow, TimesheetStatus } from "@/features/reports/models/timesheet-approvals"
import type { AppsUrlsReportData, UsageCategory } from "@/features/reports/models/apps-urls"
import { formatMoney } from "@/features/reports/utils/money"
import { toDateParam } from "@/features/reports/utils/time-and-activity/date-range"
import { formatCurrency, resolveViewerCurrency } from "@/features/reports/utils/viewer-currency"

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase() || "?"
}

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(apiPath(path))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(
      body?.error ||
        (res.status === 403
          ? "You do not have access to this report."
          : res.status === 404
            ? "This report is not available on this server."
            : `Report request failed (${res.status}).`),
    )
  }
  const json = await res.json()
  return (json?.data ?? null) as T
}


interface RawAmountMember {
  memberId: string
  name: string
  avatarUrl?: string | null
  activeSeconds: number
  rate: number
  rateType: string
  currency: string
  amount: number
  originalAmount: number
  originalRate: number
  originalCurrency: string
}
interface RawAmountsDay {
  date: string
  members: RawAmountMember[]
}

function mapAmountsDays(days: RawAmountsDay[]): AmountsOwedDayGroup[] {
  return days.map((day) => ({
    date: day.date,
    dateLabel: formatDateLabel(day.date),
    members: day.members.map((m) => ({
      name: m.name,
      initials: initialsFor(m.name),
      avatarUrl: m.avatarUrl,
      rateLabel: m.rate > 0 ? `${formatCurrency(m.rate, m.currency)}/hr` : "No rate set",
      hours: formatHms(m.activeSeconds),
      amount: formatCurrency(m.amount, m.currency),
      // What the member was actually paid, kept for the row's tooltip and the
      // CSV: the figure above is converted, and converted money gets queried.
      originalAmount:
        m.originalCurrency && m.originalCurrency !== m.currency
          ? formatCurrency(m.originalAmount, m.originalCurrency)
          : null,
    })),
  }))
}

export interface ReportQuery {
  from: string
  to: string
  memberIds?: string[]
  projectIds?: string[]
}

function reportParams(q: ReportQuery): URLSearchParams {
  const params = new URLSearchParams({ from: q.from, to: q.to })
  if (q.memberIds?.length) params.set("memberIds", q.memberIds.join(","))
  if (q.projectIds?.length) params.set("projectIds", q.projectIds.join(","))
  // Ask for the viewer's own currency. The server converts, and falls back to
  // the workspace currency if it holds no rate for it - so this is a request,
  // never an assertion about what will come back.
  const viewerCurrency = resolveViewerCurrency()
  if (viewerCurrency) params.set("displayCurrency", viewerCurrency)
  return params
}

/** What currency a report actually came back in, and how fresh the rate was. */
export interface ReportCurrencyMeta {
  displayCurrency: string
  orgCurrency: string
  requestedUnavailable: boolean
  /** The day of the oldest rate any figure leaned on; null when nothing needed
   *  converting. Shown when it trails the period being reported. */
  rateAsOf: string | null
}

const DEFAULT_CURRENCY_META: ReportCurrencyMeta = {
  displayCurrency: "USD",
  orgCurrency: "USD",
  requestedUnavailable: false,
  rateAsOf: null,
}

export interface OrgCurrencySettings {
  orgCurrency: string
  currencies: string[]
  latestRateDay: string | null
  canEdit: boolean
}

export async function fetchOrgCurrencySettings(): Promise<OrgCurrencySettings> {
  const data = await getJson<OrgCurrencySettings>("/api/reports/currency")
  return {
    orgCurrency: data?.orgCurrency ?? "USD",
    currencies: data?.currencies ?? ["USD"],
    latestRateDay: data?.latestRateDay ?? null,
    canEdit: data?.canEdit === true,
  }
}

export async function updateOrgCurrency(displayCurrency: string): Promise<string> {
  const res = await apiFetch(apiPath("/api/reports/currency"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayCurrency }),
  })
  const body = (await res.json().catch(() => null)) as { data?: { orgCurrency?: string }; error?: string } | null
  if (!res.ok) throw new Error(body?.error || `Failed to update currency (${res.status}).`)
  return body?.data?.orgCurrency ?? displayCurrency
}

export interface ReportFilterOptions {
  members: { id: string; name: string; initials: string }[]
  projects: { id: string; name: string }[]
}

export async function fetchReportFilterOptions(): Promise<ReportFilterOptions> {
  const data = await getJson<ReportFilterOptions>("/api/reports/filter-options")
  return { members: data?.members ?? [], projects: data?.projects ?? [] }
}

export async function fetchAmountsOwedReport(
  range: ReportQuery & { memberId?: string | null }
): Promise<{ days: AmountsOwedDayGroup[]; currency: ReportCurrencyMeta }> {
  const params = reportParams(range)
  if (range.memberId) params.set("memberId", range.memberId)
  const data = await getJson<{ days: RawAmountsDay[]; currency?: ReportCurrencyMeta }>(
    `/api/reports/amounts-owed?${params.toString()}`
  )
  return {
    days: data ? mapAmountsDays(data.days) : [],
    currency: data?.currency ?? DEFAULT_CURRENCY_META,
  }
}


interface RawWorkSession {
  id: string
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  projectName: string
  taskTitle: string
  startedAt: string
  endedAt: string | null
  activeSeconds: number
  idleSeconds: number
  /** IANA zone of the member who worked the shift. */
  memberTimezone?: string
  /** The day the shift belongs to in that zone, resolved server-side so this
   *  report and Time & Activity can never disagree about it. */
  localDay?: string
  /** Why it ended, already in words (PLAN-timer-stop-resilience.md D5). */
  stoppedBy?: string | null
}

/** Clock face in the worker's own timezone, not the reader's. A shift that
 *  started at 8pm for the member reads 8pm to everyone looking at it. */
function clockIn(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  })
}

/** Short zone label ("CDT", "EET") so a time is never ambiguous about which
 *  clock it is on. */
function zoneAbbreviation(iso: string, timeZone?: string): string {
  if (!timeZone) return ""
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(iso))
    .find((p) => p.type === "timeZoneName")
  return part?.value ?? ""
}

const PROJECT_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#06b6d4", "#ef4444", "#eab308"]

function colorForProject(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!
}

export async function fetchWorkSessionsReport(
  range: ReportQuery
): Promise<{ rows: WorkSessionRow[]; truncated: boolean }> {
  const params = reportParams(range)
  const data = await getJson<{ sessions: RawWorkSession[]; truncated?: boolean }>(
    `/api/reports/work-sessions?${params.toString()}`
  )
  if (!data) return { rows: [], truncated: false }
  const rows = data.sessions.map((s) => {
    const totalSeconds = s.activeSeconds + s.idleSeconds
    const projectName = s.projectName || "No project"
    return {
      id: s.id,
      // Server-resolved member-local day. The old `startedAt.slice(0, 10)`
      // was the UTC date, which put an evening shift on tomorrow.
      date: s.localDay ?? s.startedAt.slice(0, 10),
      client: "",
      projectName,
      projectLetter: (projectName[0] ?? "?").toUpperCase(),
      projectColor: colorForProject(projectName),
      memberId: s.memberId,
      memberName: s.memberName,
      memberInitials: initialsFor(s.memberName),
      memberAvatarUrl: s.memberAvatarUrl,
      todoJob: s.taskTitle || "",
      manualPct: 0,
      startedLabel: clockIn(s.startedAt, s.memberTimezone),
      stoppedLabel: s.endedAt ? clockIn(s.endedAt, s.memberTimezone) : "In progress",
      stoppedBy: s.stoppedBy ?? null,
      timezoneLabel: zoneAbbreviation(s.startedAt, s.memberTimezone),
      durationHms: formatHms(totalSeconds),
      activityPct: totalSeconds > 0 ? Math.round((s.activeSeconds / totalSeconds) * 100) : 0,
    }
  })
  return { rows, truncated: data.truncated === true }
}

export async function deleteWorkSession(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/reports/work-sessions/${id}`), { method: "DELETE" })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Failed to delete work session (${res.status}).`)
  }
}


interface RawAuditChange {
  field: string
  from: string | null
  to: string | null
}

interface RawAuditRow {
  id: string
  tableName: string
  recordId: string
  action: string
  performedByName: string
  subjectName: string
  changes: RawAuditChange[]
  createdAt: string
}

const AUDIT_ACTION_KIND: Record<string, AuditLogRow["actionKind"]> = {
  INSERT: "created",
  UPDATE: "updated",
  DELETE: "deleted",
}

function humanizeTableName(tableName: string): string {
  return tableName.replace(/_/g, " ").replace(/\w/g, (c) => c.toUpperCase())
}

function humanizeFieldName(field: string): string {
  return field.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/** "Role: Employee -> Manager, Status: active -> banned" - what the row is
 *  for. The server sends the changed fields already redacted and capped; this
 *  only phrases them. */
function describeChanges(action: string, changes: RawAuditChange[]): string {
  if (!changes?.length) return action === "DELETE" ? "Record removed" : "No field changes recorded"
  return changes
    .map((c) => {
      const label = humanizeFieldName(c.field)
      if (action === "INSERT") return `${label}: ${c.to ?? "—"}`
      if (action === "DELETE") return `${label}: ${c.from ?? "—"}`
      return `${label}: ${c.from ?? "—"} → ${c.to ?? "—"}`
    })
    .join(", ")
}

export async function fetchAuditLogReport(range: ReportQuery): Promise<{ rows: AuditLogRow[]; truncated: boolean }> {
  const params = reportParams(range)
  const data = await getJson<{ rows: RawAuditRow[]; truncated?: boolean }>(`/api/reports/audit-log?${params.toString()}`)
  if (!data) return { rows: [], truncated: false }
  return {
    truncated: data.truncated === true,
    rows: data.rows.map((r) => {
      const created = new Date(r.createdAt)
      const actionKind = AUDIT_ACTION_KIND[r.action] ?? "archived"
      return {
        id: r.id,
        // Date and time are both read on the viewer's clock. They used to
        // disagree: the date was sliced off the UTC ISO string while the time
        // was localised, so from New York a 02:00Z event read "Sep 10, 10:00 PM".
        date: toDateParam(created),
        author: r.performedByName,
        timeLabel: created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        action:
          actionKind === "created" ? "Created" : actionKind === "updated" ? "Updated" : actionKind === "deleted" ? "Deleted" : r.action,
        actionKind,
        object: humanizeTableName(r.tableName),
        member: r.subjectName || "—",
        detail: describeChanges(r.action, r.changes ?? []),
      }
    }),
  }
}


interface RawProjectBudgetRow {
  projectId: string
  projectName: string
  hasBudget: boolean
  budgetType: string | null
  cost: number
  spentSeconds: number
  spentAmount: number
}

const AVATAR_CLASS_BY_INDEX = [
  "bg-blue-500 text-white",
  "bg-violet-500 text-white",
  "bg-pink-500 text-white",
  "bg-orange-500 text-white",
  "bg-emerald-500 text-white",
]

export async function fetchProjectBudgetsReport(query?: { projectIds?: string[] }): Promise<ProjectBudgetSection[]> {
  const params = new URLSearchParams()
  if (query?.projectIds?.length) params.set("projectIds", query.projectIds.join(","))
  const qs = params.toString()
  const data = await getJson<{ rows: RawProjectBudgetRow[] }>(
    `/api/reports/project-budgets${qs ? `?${qs}` : ""}`
  )
  if (!data) return []

  const withBudget: ProjectBudgetRow[] = []
  const withoutBudget: ProjectBudgetRow[] = []

  data.rows.forEach((row, i) => {
    const isHours = row.budgetType === "Hours based"
    const mapped: ProjectBudgetRow = {
      projectName: row.projectName,
      initial: (row.projectName[0] ?? "?").toUpperCase(),
      avatarClassName: AVATAR_CLASS_BY_INDEX[i % AVATAR_CLASS_BY_INDEX.length]!,
      budgetType: row.hasBudget ? (isHours ? "hours" : "cost") : null,
      spentSeconds: row.spentSeconds,
      budgetSeconds: isHours ? Math.round(row.cost * 3600) : 0,
      spentAmount: isHours ? 0 : row.spentAmount,
      budgetAmount: isHours ? 0 : row.cost,
    }
    ;(row.hasBudget ? withBudget : withoutBudget).push(mapped)
  })

  const sections: ProjectBudgetSection[] = []
  if (withBudget.length > 0) sections.push({ label: "Budgeted projects", rows: withBudget })
  if (withoutBudget.length > 0) sections.push({ label: "No budget set", rows: withoutBudget })
  return sections
}


interface RawClientBudgetRow {
  clientId: string
  clientName: string
  hasBudget: boolean
  budgetType: string | null
  cap: number
  spentAmount: number
  pctUsed: number
}

export async function fetchClientBudgetsReport(): Promise<ClientBudgetRow[]> {
  const data = await getJson<{ rows: RawClientBudgetRow[] }>("/api/reports/client-budgets")
  if (!data) return []
  return data.rows.map((row, i) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    initial: (row.clientName[0] ?? "?").toUpperCase(),
    avatarClassName: AVATAR_CLASS_BY_INDEX[i % AVATAR_CLASS_BY_INDEX.length]!,
    hasBudget: row.hasBudget,
    budgetType: row.budgetType,
    cap: row.cap,
    spentAmount: row.spentAmount,
    pctUsed: row.pctUsed,
  }))
}


interface RawLimitRow {
  memberId: string
  name: string
  limitHours: number
  totalTrackedHours: number
  periods: number
  periodsOverLimit: number
  peakPctUsed: number
  periodRows: LimitPeriodRow[]
}

async function fetchLimitsReport(kind: "weekly-limits" | "daily-limits", range: ReportQuery): Promise<LimitUsageRow[]> {
  const params = reportParams(range)
  const data = await getJson<{ rows: RawLimitRow[] }>(`/api/reports/${kind}?${params.toString()}`)
  if (!data) return []
  return data.rows.map((row) => ({
    memberId: row.memberId,
    name: row.name,
    initials: initialsFor(row.name),
    limitHours: row.limitHours,
    totalTrackedHours: row.totalTrackedHours,
    periods: row.periods,
    periodsOverLimit: row.periodsOverLimit,
    peakPctUsed: row.peakPctUsed,
    periodRows: row.periodRows ?? [],
  }))
}

export function fetchWeeklyLimitsReport(range: ReportQuery): Promise<LimitUsageRow[]> {
  return fetchLimitsReport("weekly-limits", range)
}

export function fetchDailyLimitsReport(range: ReportQuery): Promise<LimitUsageRow[]> {
  return fetchLimitsReport("daily-limits", range)
}


interface RawTimesheetRow {
  id: string
  memberId: string
  memberName: string
  periodStart: string
  periodEnd: string
  status: TimesheetStatus
  totalHours: number
  billableHours: number
  submittedAt: string | null
  approvedAt: string | null
  approvedByName: string | null
}

export async function fetchTimesheetApprovalsReport(
  range: ReportQuery
): Promise<{ rows: TimesheetApprovalRow[]; truncated: boolean }> {
  const params = reportParams(range)
  const data = await getJson<{ rows: RawTimesheetRow[]; truncated?: boolean }>(
    `/api/reports/timesheet-approvals?${params.toString()}`
  )
  if (!data) return { rows: [], truncated: false }
  const rows = data.rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName,
    initials: initialsFor(row.memberName),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    totalHours: row.totalHours,
    billableHours: row.billableHours,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    approvedByName: row.approvedByName,
  }))
  return { rows, truncated: data.truncated === true }
}


interface RawAppUsageRow {
  memberId: string
  memberName: string
  appName: string
  category: UsageCategory
  totalSeconds: number
}
interface RawUrlUsageRow {
  memberId: string
  memberName: string
  domain: string
  category: UsageCategory
  identifiedBy: string
  totalSeconds: number
}

export async function fetchAppsUrlsReport(range: ReportQuery): Promise<AppsUrlsReportData> {
  const params = reportParams(range)
  const data = await getJson<{ apps: RawAppUsageRow[]; urls: RawUrlUsageRow[]; truncated?: boolean }>(
    `/api/reports/apps-urls?${params.toString()}`
  )
  if (!data) return { apps: [], urls: [], truncated: false }
  return {
    apps: data.apps.map((a) => ({
      memberId: a.memberId,
      memberName: a.memberName,
      appName: a.appName,
      category: a.category ?? "unclassified",
      durationHms: formatHms(a.totalSeconds),
      totalSeconds: a.totalSeconds,
    })),
    urls: data.urls.map((u) => ({
      memberId: u.memberId,
      memberName: u.memberName,
      domain: u.domain,
      category: u.category ?? "unclassified",
      identifiedBy: u.identifiedBy ?? "address bar",
      durationHms: formatHms(u.totalSeconds),
      totalSeconds: u.totalSeconds,
    })),
    truncated: data.truncated === true,
  }
}


export interface ManualTimeEditRow {
  id: string
  day: string
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  projectName: string
  taskTitle: string
  hours: number
  description: string
  billable: boolean
  status: string
  editedByName: string
  editedAt: string | null
}

export async function fetchManualTimeEditsReport(
  range: ReportQuery
): Promise<{ rows: ManualTimeEditRow[]; truncated: boolean }> {
  const data = await getJson<{ rows: ManualTimeEditRow[]; truncated?: boolean }>(
    `/api/reports/manual-time-edits?${reportParams(range).toString()}`
  )
  return { rows: data?.rows ?? [], truncated: data?.truncated === true }
}


export interface WorkBreakRow {
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  day: string
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number
  /** IANA zone of the member the break belongs to. `day` is already bucketed
   *  in it server-side; this lets the start/end clock match. */
  memberTimezone?: string
}

export async function fetchWorkBreaksReport(
  range: ReportQuery & { minGapMinutes?: number }
): Promise<{ rows: WorkBreakRow[]; minGapMinutes: number; truncated: boolean }> {
  const params = reportParams(range)
  if (range.minGapMinutes) params.set("minGapMinutes", String(range.minGapMinutes))
  const data = await getJson<{ rows: WorkBreakRow[]; minGapMinutes: number; truncated?: boolean }>(
    `/api/reports/work-breaks?${params.toString()}`
  )
  return {
    rows: data?.rows ?? [],
    minGapMinutes: data?.minGapMinutes ?? 5,
    truncated: data?.truncated === true,
  }
}


export interface ExpenseReportRow {
  id: string
  day: string
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  projectName: string
  clientName: string
  category: string
  description: string
  amount: number
  currency: string
  billable: boolean
  status: string
}

export async function fetchExpensesReport(
  range: ReportQuery
): Promise<{ rows: ExpenseReportRow[]; truncated: boolean }> {
  const data = await getJson<{ rows: ExpenseReportRow[]; truncated?: boolean }>(
    `/api/reports/expenses?${reportParams(range).toString()}`
  )
  return { rows: data?.rows ?? [], truncated: data?.truncated === true }
}


export interface TimeOffBalanceRow {
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  policyId: string
  policyName: string
  entitlementDays: number
  accruedDays: number
  usedDays: number
  balanceDays: number
}

export async function fetchTimeOffBalancesReport(
  range: ReportQuery
): Promise<{ rows: TimeOffBalanceRow[]; asOf: string }> {
  const data = await getJson<{ rows: TimeOffBalanceRow[]; asOf: string }>(
    `/api/reports/time-off-balances?${reportParams(range).toString()}`
  )
  return { rows: data?.rows ?? [], asOf: data?.asOf ?? range.to }
}

export interface TimeOffTransactionRow {
  id: string
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  policyId: string
  policyName: string
  requestId: string | null
  kind: "accrual" | "usage" | "adjustment"
  days: number
  effectiveOn: string
  note: string
}

export async function fetchTimeOffTransactionsReport(range: ReportQuery): Promise<TimeOffTransactionRow[]> {
  const data = await getJson<{ rows: TimeOffTransactionRow[] }>(
    `/api/reports/time-off-transactions?${reportParams(range).toString()}`
  )
  return data?.rows ?? []
}


export interface InvoiceReportRow {
  id: string
  number: string
  clientName: string
  memberId: string | null
  memberName: string
  issueDate: string
  dueDate: string
  status: string
  total: number
  paidAmount: number
  dueAmount: number
  currency: string
}

export interface InvoiceAgingRow extends Omit<InvoiceReportRow, "status"> {
  daysOverdue: number
  bucket: string
}

export async function fetchInvoicesReport(
  kind: "client" | "team",
  range: ReportQuery
): Promise<InvoiceReportRow[]> {
  const data = await getJson<{ rows: InvoiceReportRow[] }>(
    `/api/reports/${kind}-invoices?${reportParams(range).toString()}`
  )
  return data?.rows ?? []
}

export async function fetchInvoiceAgingReport(
  kind: "client" | "team",
  range: ReportQuery
): Promise<{ rows: InvoiceAgingRow[]; asOf: string }> {
  const data = await getJson<{ rows: InvoiceAgingRow[]; asOf: string }>(
    `/api/reports/${kind}-invoices-aging?${reportParams(range).toString()}`
  )
  return { rows: data?.rows ?? [], asOf: data?.asOf ?? range.to }
}


export interface PaymentReportRow {
  id: string
  invoiceId: string
  invoiceNumber: string
  kind: "client" | "team"
  memberId: string | null
  memberName: string
  clientName: string
  amount: number
  currency: string
  paidOn: string
  method: string
  reference: string
}

export async function fetchPaymentsRecordedReport(range: ReportQuery): Promise<PaymentReportRow[]> {
  const data = await getJson<{ rows: PaymentReportRow[] }>(`/api/reports/payments?${reportParams(range).toString()}`)
  return data?.rows ?? []
}


export type ShiftAttendanceStatus = "worked" | "missed" | "excused" | "time-off" | "unscheduled"

export interface ShiftAttendanceRow {
  memberId: string
  memberName: string
  memberAvatarUrl?: string | null
  day: string
  scheduled: boolean
  /** A day agreed to cover an earlier missed one - expected work, even though
   *  it falls outside the member's usual working days. */
  makeupDay: boolean
  activeSeconds: number
  status: ShiftAttendanceStatus
}

export async function fetchShiftAttendanceReport(
  range: ReportQuery
): Promise<{ rows: ShiftAttendanceRow[]; truncated: boolean }> {
  const data = await getJson<{ rows: ShiftAttendanceRow[]; truncated?: boolean }>(
    `/api/reports/shift-attendance?${reportParams(range).toString()}`
  )
  return { rows: data?.rows ?? [], truncated: data?.truncated === true }
}
