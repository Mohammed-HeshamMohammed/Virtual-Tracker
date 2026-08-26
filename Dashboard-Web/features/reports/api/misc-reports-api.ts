// Fetch + map real backend rows (reports/routes.js) into the exact display
// shapes the existing report components already render against - keeps the
// component/render code untouched, only the data source changes.
import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { AmountsOwedDayGroup } from "@/features/reports/components/shared/constants"
import type { AuditLogRow } from "@/features/reports/models/audit-log"
import type { WorkSessionRow } from "@/features/reports/models/work-sessions"
import type { ProjectBudgetSection, ProjectBudgetRow } from "@/features/reports/models/project-budgets"
import type { ClientBudgetRow } from "@/features/reports/models/client-budgets"
import type { LimitUsageRow } from "@/features/reports/models/limits"
import type { TimesheetApprovalRow, TimesheetStatus } from "@/features/reports/models/timesheet-approvals"
import type { AppUsageRow, UrlUsageRow } from "@/features/reports/models/apps-urls"

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

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(apiPath(path))
    if (!res.ok) return null
    const json = await res.json()
    return json?.data ?? null
  } catch {
    return null
  }
}

// ─── Amounts Owed / Daily Totals / Payments (same shape) ────────────────────

interface RawAmountMember {
  memberId: string
  name: string
  activeSeconds: number
  rate: number
  rateType: string
  currency: string
  amount: number
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
      rateLabel: m.rate > 0 ? `${m.currency} ${m.rate.toFixed(2)}/hr` : "No rate set",
      hours: formatHms(m.activeSeconds),
      amount: `$${m.amount.toFixed(2)}`,
    })),
  }))
}

/** Range plus the shared report filter selections. */
export interface ReportQuery {
  from: string
  to: string
  memberIds?: string[]
  projectIds?: string[]
}

/** Builds the query string every report endpoint understands. */
function reportParams(q: ReportQuery): URLSearchParams {
  const params = new URLSearchParams({ from: q.from, to: q.to })
  if (q.memberIds?.length) params.set("memberIds", q.memberIds.join(","))
  if (q.projectIds?.length) params.set("projectIds", q.projectIds.join(","))
  return params
}

export interface ReportFilterOptions {
  members: { id: string; name: string; initials: string }[]
  projects: { id: string; name: string }[]
}

/** Real members/projects the viewer may filter by, for the report filter panels. */
export async function fetchReportFilterOptions(): Promise<ReportFilterOptions> {
  const data = await getJson<ReportFilterOptions>("/api/reports/filter-options")
  return { members: data?.members ?? [], projects: data?.projects ?? [] }
}

/** `memberId` scopes to one member (the "ME" tab); `memberIds`/`projectIds` back
 *  the filter panel's multi-selects. The backend rejects ids outside the
 *  viewer's visible scope, so these are filters, not a trust point. */
export async function fetchAmountsOwedReport(
  range: ReportQuery & { memberId?: string | null }
): Promise<AmountsOwedDayGroup[]> {
  const params = reportParams(range)
  if (range.memberId) params.set("memberId", range.memberId)
  const data = await getJson<{ days: RawAmountsDay[] }>(`/api/reports/amounts-owed?${params.toString()}`)
  return data ? mapAmountsDays(data.days) : []
}

export async function fetchPaymentsReport(range: {
  from: string
  to: string
  memberId?: string | null
}): Promise<AmountsOwedDayGroup[]> {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  if (range.memberId) params.set("memberId", range.memberId)
  const data = await getJson<{ days: RawAmountsDay[] }>(`/api/reports/payments?${params.toString()}`)
  return data ? mapAmountsDays(data.days) : []
}

// ─── Work Sessions ────────────────────────────────────────────────────────

interface RawWorkSession {
  id: string
  memberId: string
  memberName: string
  projectName: string
  taskTitle: string
  startedAt: string
  endedAt: string | null
  activeSeconds: number
  idleSeconds: number
}

const PROJECT_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#06b6d4", "#ef4444", "#eab308"]

function colorForProject(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!
}

export async function fetchWorkSessionsReport(range: ReportQuery): Promise<WorkSessionRow[]> {
  const params = reportParams(range)
  const data = await getJson<{ sessions: RawWorkSession[] }>(`/api/reports/work-sessions?${params.toString()}`)
  if (!data) return []
  return data.sessions.map((s) => {
    const started = new Date(s.startedAt)
    const ended = s.endedAt ? new Date(s.endedAt) : null
    const totalSeconds = s.activeSeconds + s.idleSeconds
    const projectName = s.projectName || "No project"
    return {
      id: s.id,
      date: s.startedAt.slice(0, 10),
      client: "",
      projectName,
      projectLetter: (projectName[0] ?? "?").toUpperCase(),
      projectColor: colorForProject(projectName),
      memberId: s.memberId,
      memberName: s.memberName,
      memberInitials: initialsFor(s.memberName),
      todoJob: s.taskTitle || "",
      manualPct: 0,
      startedLabel: started.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      stoppedLabel: ended ? ended.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "In progress",
      durationHms: formatHms(totalSeconds),
      activityPct: totalSeconds > 0 ? Math.round((s.activeSeconds / totalSeconds) * 100) : 0,
    }
  })
}

// ─── Audit Log ────────────────────────────────────────────────────────────

interface RawAuditRow {
  id: string
  tableName: string
  recordId: string
  action: string
  performedByName: string
  createdAt: string
}

const AUDIT_ACTION_KIND: Record<string, AuditLogRow["actionKind"]> = {
  INSERT: "created",
  UPDATE: "updated",
  DELETE: "deleted",
}

function humanizeTableName(tableName: string): string {
  return tableName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function fetchAuditLogReport(range: ReportQuery): Promise<AuditLogRow[]> {
  const params = reportParams(range)
  const data = await getJson<{ rows: RawAuditRow[] }>(`/api/reports/audit-log?${params.toString()}`)
  if (!data) return []
  return data.rows.map((r) => {
    const created = new Date(r.createdAt)
    const actionKind = AUDIT_ACTION_KIND[r.action] ?? "archived"
    return {
      id: r.id,
      date: r.createdAt.slice(0, 10),
      author: r.performedByName,
      timeLabel: created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      action: actionKind === "created" ? "Created" : actionKind === "updated" ? "Updated" : actionKind === "deleted" ? "Deleted" : r.action,
      actionKind,
      object: humanizeTableName(r.tableName),
      member: "—",
      detail: `${humanizeTableName(r.tableName)} record ${r.recordId.slice(0, 8)}`,
    }
  })
}

// ─── Project Budgets ──────────────────────────────────────────────────────

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

export async function fetchProjectBudgetsReport(): Promise<ProjectBudgetSection[]> {
  const data = await getJson<{ rows: RawProjectBudgetRow[] }>("/api/reports/project-budgets")
  if (!data) return []

  const withBudget: ProjectBudgetRow[] = []
  const withoutBudget: ProjectBudgetRow[] = []

  data.rows.forEach((row, i) => {
    // Hours-based budgets are a real time cap (cost = hours) - render faithfully.
    // Cost-based budgets are a dollar cap, not a time quantity; this table is
    // seconds-only, so we show real tracked time with no (misleading) cap line
    // rather than fake-converting dollars into a duration.
    const budgetSeconds = row.budgetType === "Hours based" ? Math.round(row.cost * 3600) : 0
    const mapped: ProjectBudgetRow = {
      projectName: row.projectName,
      initial: (row.projectName[0] ?? "?").toUpperCase(),
      avatarClassName: AVATAR_CLASS_BY_INDEX[i % AVATAR_CLASS_BY_INDEX.length]!,
      spentSeconds: row.spentSeconds,
      budgetSeconds,
    }
    ;(row.hasBudget ? withBudget : withoutBudget).push(mapped)
  })

  const sections: ProjectBudgetSection[] = []
  if (withBudget.length > 0) sections.push({ label: "Budgeted projects", rows: withBudget })
  if (withoutBudget.length > 0) sections.push({ label: "No budget set", rows: withoutBudget })
  return sections
}

// ─── Client Budgets ───────────────────────────────────────────────────────

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

// ─── Weekly Limits / Daily Limits ────────────────────────────────────────

interface RawLimitRow {
  memberId: string
  name: string
  limitHours: number
  trackedHours: number
  pctUsed: number
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
    trackedHours: row.trackedHours,
    pctUsed: row.pctUsed,
  }))
}

export function fetchWeeklyLimitsReport(range: ReportQuery): Promise<LimitUsageRow[]> {
  return fetchLimitsReport("weekly-limits", range)
}

export function fetchDailyLimitsReport(range: ReportQuery): Promise<LimitUsageRow[]> {
  return fetchLimitsReport("daily-limits", range)
}

// ─── Timesheet Approvals ──────────────────────────────────────────────────

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

export async function fetchTimesheetApprovalsReport(range: ReportQuery): Promise<TimesheetApprovalRow[]> {
  const params = reportParams(range)
  const data = await getJson<{ rows: RawTimesheetRow[] }>(`/api/reports/timesheet-approvals?${params.toString()}`)
  if (!data) return []
  return data.rows.map((row) => ({
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
}

// ─── Apps & URLs ──────────────────────────────────────────────────────────

interface RawAppUsageRow {
  memberId: string
  memberName: string
  appName: string
  totalSeconds: number
}
interface RawUrlUsageRow {
  memberId: string
  memberName: string
  domain: string
  totalSeconds: number
}

export async function fetchAppsUrlsReport(
  range: ReportQuery
): Promise<{ apps: AppUsageRow[]; urls: UrlUsageRow[] }> {
  const params = reportParams(range)
  const data = await getJson<{ apps: RawAppUsageRow[]; urls: RawUrlUsageRow[] }>(`/api/reports/apps-urls?${params.toString()}`)
  if (!data) return { apps: [], urls: [] }
  return {
    apps: data.apps.map((a) => ({
      memberId: a.memberId,
      memberName: a.memberName,
      appName: a.appName,
      durationHms: formatHms(a.totalSeconds),
    })),
    urls: data.urls.map((u) => ({
      memberId: u.memberId,
      memberName: u.memberName,
      domain: u.domain,
      durationHms: formatHms(u.totalSeconds),
    })),
  }
}

// ─── Manual Time Edits ────────────────────────────────────────────────────

export interface ManualTimeEditRow {
  id: string
  day: string
  memberId: string
  memberName: string
  projectName: string
  taskTitle: string
  hours: number
  description: string
  billable: boolean
  status: string
  editedByName: string
  editedAt: string | null
}

export async function fetchManualTimeEditsReport(range: ReportQuery): Promise<ManualTimeEditRow[]> {
  const data = await getJson<{ rows: ManualTimeEditRow[] }>(
    `/api/reports/manual-time-edits?${reportParams(range).toString()}`
  )
  return data?.rows ?? []
}

// ─── Work Breaks ──────────────────────────────────────────────────────────

export interface WorkBreakRow {
  memberId: string
  memberName: string
  day: string
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number
}

export async function fetchWorkBreaksReport(
  range: ReportQuery & { minGapMinutes?: number }
): Promise<{ rows: WorkBreakRow[]; minGapMinutes: number }> {
  const params = reportParams(range)
  if (range.minGapMinutes) params.set("minGapMinutes", String(range.minGapMinutes))
  const data = await getJson<{ rows: WorkBreakRow[]; minGapMinutes: number }>(
    `/api/reports/work-breaks?${params.toString()}`
  )
  return { rows: data?.rows ?? [], minGapMinutes: data?.minGapMinutes ?? 5 }
}

// ─── Expenses ─────────────────────────────────────────────────────────────

export interface ExpenseReportRow {
  id: string
  day: string
  memberId: string
  memberName: string
  projectName: string
  clientName: string
  category: string
  description: string
  amount: number
  currency: string
  billable: boolean
  status: string
}

export async function fetchExpensesReport(range: ReportQuery): Promise<ExpenseReportRow[]> {
  const data = await getJson<{ rows: ExpenseReportRow[] }>(`/api/reports/expenses?${reportParams(range).toString()}`)
  return data?.rows ?? []
}

// ─── Time off ─────────────────────────────────────────────────────────────

export interface TimeOffBalanceRow {
  memberId: string
  memberName: string
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

// ─── Invoices ─────────────────────────────────────────────────────────────

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

// ─── Payments ─────────────────────────────────────────────────────────────

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

// ─── Shift attendance ─────────────────────────────────────────────────────

export interface ShiftAttendanceRow {
  memberId: string
  memberName: string
  day: string
  scheduled: boolean
  activeSeconds: number
  status: "worked" | "missed" | "unscheduled"
}

export async function fetchShiftAttendanceReport(range: ReportQuery): Promise<ShiftAttendanceRow[]> {
  const data = await getJson<{ rows: ShiftAttendanceRow[] }>(
    `/api/reports/shift-attendance?${reportParams(range).toString()}`
  )
  return data?.rows ?? []
}
