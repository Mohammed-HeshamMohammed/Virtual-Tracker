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
  duration: number // in minutes
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

export async function submitTimesheet(id: string, submittedBy?: string): Promise<Timesheet> {
  const res = await apiFetch(apiPath(`/api/timesheets/${id}/submit`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submittedBy }),
  })
  if (!res.ok) throw new Error(`Failed to submit timesheet: ${res.status}`)
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to submit timesheet")
  return toTimesheet(json.data)
}

export async function approveTimesheet(id: string, approvedBy?: string): Promise<Timesheet> {
  const res = await apiFetch(apiPath(`/api/timesheets/${id}/approve`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvedBy }),
  })
  if (!res.ok) throw new Error(`Failed to approve timesheet: ${res.status}`)
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to approve timesheet")
  return toTimesheet(json.data)
}

export async function rejectTimesheet(id: string, reason?: string, rejectedBy?: string): Promise<Timesheet> {
  const res = await apiFetch(apiPath(`/api/timesheets/${id}/reject`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, rejectedBy }),
  })
  if (!res.ok) throw new Error(`Failed to reject timesheet: ${res.status}`)
  assertTimesheetsAvailable(res.status)
  const json = (await res.json()) as ApiEnvelope<unknown>
  if (!json.success) throw new Error(json.error || "Failed to reject timesheet")
  return toTimesheet(json.data)
}
