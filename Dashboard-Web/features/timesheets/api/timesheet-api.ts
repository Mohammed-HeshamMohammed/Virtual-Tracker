import { apiPath } from "@/infrastructure/api/path"
import { extractApiError, apiFetch, fetchJsonWithRetry, type ApiEnvelope, type RequestOptions } from "@/infrastructure/api/http"

/** Schema CRUD at /api/time-entries and /api/timesheets (see Backend schema catalog). */
const TIMESHEETS_NOT_ON_BACKEND =
  "Timesheets API is not available. Ensure Backend is running and schema catalog includes time-entries."

function assertTimesheetsAvailable(status: number): void {
  if (status === 404) {
    throw new Error(TIMESHEETS_NOT_ON_BACKEND)
  }
}

function toTimeEntry(input: any): TimeEntry {
  return {
    id: input.id,
    memberId: input.memberId ?? input.member_id ?? "",
    projectId: input.projectId ?? input.project_id ?? "",
    taskId: input.taskId ?? input.task_id ?? "",
    date: input.date ?? "",
    startTime: input.startTime ?? input.start_time ?? "",
    endTime: input.endTime ?? input.end_time ?? "",
    duration: Number(input.duration ?? 0),
    description: input.description ?? "",
    billable: Boolean(input.billable),
    status: input.status ?? "draft",
    createdAt: input.createdAt ?? input.created_at ?? "",
    updatedAt: input.updatedAt ?? input.updated_at ?? "",
  }
}

function toTimesheet(input: any): Timesheet {
  return {
    id: input.id,
    memberId: input.memberId ?? input.member_id ?? "",
    periodStart: input.periodStart ?? input.period_start ?? "",
    periodEnd: input.periodEnd ?? input.period_end ?? "",
    status: input.status ?? "draft",
    totalHours: Number(input.totalHours ?? input.total_hours ?? 0),
    billableHours: Number(input.billableHours ?? input.billable_hours ?? 0),
    entries: Array.isArray(input.entries) ? input.entries.map(toTimeEntry) : [],
    submittedAt: input.submittedAt ?? input.submitted_at ?? null,
    approvedAt: input.approvedAt ?? input.approved_at ?? null,
    approvedBy: input.approvedBy ?? input.approved_by ?? null,
  }
}

// Types
export interface TimeEntry {
  id: string
  memberId: string
  projectId: string
  taskId?: string
  date: string
  startTime: string
  endTime: string
  /** Seconds. Matches the backend column and every reader of it. */
  duration: number
  description: string
  billable: boolean
  status: "draft" | "submitted" | "approved" | "rejected"
  createdAt: string
  updatedAt: string
}

export interface Timesheet {
  id: string
  memberId: string
  periodStart: string
  periodEnd: string
  status: "draft" | "submitted" | "approved" | "rejected"
  totalHours: number
  billableHours: number
  entries: TimeEntry[]
  submittedAt: string | null
  approvedAt: string | null
  approvedBy: string | null
}

export interface CreateTimeEntryInput {
  memberId: string
  projectId: string
  taskId?: string
  date: string
  startTime: string
  endTime: string
  duration: number
  description?: string
  billable?: boolean
}

export interface UpdateTimeEntryInput {
  projectId?: string
  taskId?: string
  date?: string
  startTime?: string
  endTime?: string
  duration?: number
  description?: string
  billable?: boolean
}

// API Functions
export async function getTimeEntries(filters?: { 
  memberId?: string; 
  projectId?: string; 
  startDate?: string; 
  endDate?: string;
  status?: string;
}, options: RequestOptions = {}): Promise<TimeEntry[]> {
  const params = new URLSearchParams()
  if (filters?.memberId) params.append("member_id", filters.memberId)
  if (filters?.projectId) params.append("project_id", filters.projectId)
  if (filters?.startDate) params.append("start_date", filters.startDate)
  if (filters?.endDate) params.append("end_date", filters.endDate)
  if (filters?.status) params.append("status", filters.status)
  
  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<unknown[]>>(
    apiPath(`/api/time-entries${query}`),
    {},
    { ...options, retries: 1 },
  )
  assertTimesheetsAvailable(res.status)
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch time entries", json)
  if (!json) throw new Error("Failed to parse time entries response")
  if (!json.success) throw new Error(json.error || "Failed to fetch time entries")
  return (json.data ?? []).map(toTimeEntry)
}

export async function getTimeEntry(id: string): Promise<TimeEntry> {
  const res = await apiFetch(apiPath(`/api/time-entries/${id}`))
  assertTimesheetsAvailable(res.status)
  if (!res.ok) throw new Error(`Failed to fetch time entry: ${res.status}`)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to fetch time entry")
  return toTimeEntry(json.data)
}

export async function createTimeEntry(data: CreateTimeEntryInput, createdBy?: string): Promise<TimeEntry> {
  const res = await apiFetch(apiPath("/api/time-entries"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, member_id: data.memberId, project_id: data.projectId, task_id: data.taskId, created_by: createdBy }),
  })
  if (!res.ok) throw new Error(`Failed to create time entry: ${res.status}`)
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to create time entry")
  return toTimeEntry(json.data)
}

export async function updateTimeEntry(id: string, data: UpdateTimeEntryInput, updatedBy?: string): Promise<TimeEntry> {
  const res = await apiFetch(apiPath(`/api/time-entries/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, project_id: data.projectId, task_id: data.taskId, updated_by: updatedBy }),
  })
  if (!res.ok) throw new Error(`Failed to update time entry: ${res.status}`)
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to update time entry")
  return toTimeEntry(json.data)
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/time-entries/${id}`), { method: "DELETE" })
  assertTimesheetsAvailable(res.status)
  if (!res.ok) throw new Error(`Failed to delete time entry: ${res.status}`)
}

// Timesheets
export async function getTimesheets(filters?: { 
  memberId?: string; 
  status?: string;
  periodStart?: string;
  periodEnd?: string;
}, options: RequestOptions = {}): Promise<Timesheet[]> {
  const params = new URLSearchParams()
  if (filters?.memberId) params.append("member_id", filters.memberId)
  if (filters?.status) params.append("status", filters.status)
  if (filters?.periodStart) params.append("period_start", filters.periodStart)
  if (filters?.periodEnd) params.append("period_end", filters.periodEnd)
  
  const query = params.toString() ? `?${params.toString()}` : ""
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<unknown[]>>(
    apiPath(`/api/timesheets${query}`),
    {},
    { ...options, retries: 1 },
  )
  assertTimesheetsAvailable(res.status)
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch timesheets", json)
  if (!json) throw new Error("Failed to parse timesheets response")
  if (!json.success) throw new Error(json.error || "Failed to fetch timesheets")
  return (json.data ?? []).map(toTimesheet)
}

export async function getTimesheet(id: string): Promise<Timesheet> {
  const res = await apiFetch(apiPath(`/api/timesheets/${id}`))
  assertTimesheetsAvailable(res.status)
  if (!res.ok) throw new Error(`Failed to fetch timesheet: ${res.status}`)
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to fetch timesheet")
  return toTimesheet(json.data)
}

// submit/approve/reject all go through the generic schema CRUD PATCH
// (/api/timesheets/:id) rather than bespoke sub-routes - the backend already
// gates writes to this entity to management roles there (schema/routes.js),
// and the field-name mapping (status/approved_at/approved_by) is already
// declared in the timesheets catalog entity, so no new backend route is needed.
async function patchTimesheet(id: string, body: Record<string, unknown>): Promise<Timesheet> {
  const res = await apiFetch(apiPath(`/api/timesheets/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!res.ok || !json.success) throw new Error(json.error || `Failed to update timesheet: ${res.status}`)
  return toTimesheet(json.data)
}

export interface TimesheetPeriodSummary {
  memberId: string
  periodStart: string
  periodEnd: string
  totalHours: number
  billableHours: number
  timesheet: {
    id: string
    status: "draft" | "submitted" | "approved" | "rejected"
    submitted_at: string | null
    total_hours: number | null
    billable_hours: number | null
  } | null
}

/** Hours the member has actually tracked in a period, plus any existing
 *  timesheet row for it. Server-computed - never derived on the client. */
export async function fetchTimesheetPeriodSummary(
  periodStart: string,
  periodEnd: string,
  memberId?: string,
): Promise<TimesheetPeriodSummary | null> {
  const params = new URLSearchParams({ from: periodStart, to: periodEnd })
  if (memberId) params.set("memberId", memberId)
  const res = await apiFetch(apiPath(`/api/timesheets/period-summary?${params.toString()}`))
  if (!res.ok) return null
  const json = (await res.json()) as ApiEnvelope<TimesheetPeriodSummary>
  return json.success ? (json.data ?? null) : null
}

/** Persist the Approvals "Set it up" settings onto each member's pay_rates
 *  row (pay_period + require_timesheet_approval). Management-gated and
 *  scope-checked server-side. */
export async function saveTimesheetApprovalSetup(input: {
  memberIds: string[]
  payPeriod: string
  autoSetup: boolean
}): Promise<string[]> {
  const res = await apiFetch(apiPath("/api/timesheets/approval-setup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = (await res.json().catch(() => null)) as ApiEnvelope<{ updated: string[] }> | null
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Failed to save timesheet approval settings")
  }
  return json.data?.updated ?? []
}

/** Submit the signed-in member's own timesheet for a pay period. Hours are
 *  computed server-side from tracked time, so none are sent from here. */
export async function submitTimesheetPeriod(periodStart: string, periodEnd: string): Promise<Timesheet> {
  const res = await apiFetch(apiPath("/api/timesheets/submit"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodStart, periodEnd }),
  })
  const json = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Failed to submit timesheet")
  }
  return toTimesheet(json.data)
}

export function approveTimesheet(id: string, approvedBy: string): Promise<Timesheet> {
  return patchTimesheet(id, { status: "approved", approved_at: new Date().toISOString(), approved_by: approvedBy })
}

export function rejectTimesheet(id: string, approvedBy: string): Promise<Timesheet> {
  return patchTimesheet(id, { status: "rejected", approved_at: new Date().toISOString(), approved_by: approvedBy })
}
