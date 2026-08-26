import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(apiPath(path), init)
  const json = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || !json?.success) throw new Error(json?.error || "Request failed")
  return json.data as T
}

export interface TimeOffPolicy {
  id: string
  name: string
  description: string
  days_per_year: number | string
  paid: boolean
  requires_approval: boolean
  active: boolean
}

export type TimeOffRequestStatus = "pending" | "approved" | "rejected" | "cancelled"

export interface TimeOffRequest {
  id: string
  member_id: string
  member_name: string
  policy_id: string
  policy_name: string
  start_date: string
  end_date: string
  days: number
  note: string
  status: TimeOffRequestStatus
  review_note: string
}

export function listTimeOffPolicies(): Promise<TimeOffPolicy[]> {
  return call<TimeOffPolicy[]>("/api/time-off/policies")
}

export function createTimeOffPolicy(input: {
  name: string
  description?: string
  daysPerYear: number
  paid?: boolean
  requiresApproval?: boolean
}): Promise<TimeOffPolicy> {
  return call<TimeOffPolicy>("/api/time-off/policies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function listTimeOffRequests(
  filters: { status?: TimeOffRequestStatus; memberId?: string; from?: string; to?: string } = {}
): Promise<TimeOffRequest[]> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, String(v))
  })
  const qs = params.toString()
  return call<TimeOffRequest[]>(`/api/time-off/requests${qs ? `?${qs}` : ""}`)
}

export function createTimeOffRequest(input: {
  policyId: string
  startDate: string
  endDate: string
  note?: string
}): Promise<TimeOffRequest> {
  return call<TimeOffRequest>("/api/time-off/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

/** approved/rejected are management actions; cancelled is self-service on your
 *  own pending request. Both rules are enforced server-side. */
export function reviewTimeOffRequest(
  id: string,
  status: "approved" | "rejected" | "cancelled",
  reviewNote?: string
): Promise<TimeOffRequest> {
  return call<TimeOffRequest>(`/api/time-off/requests/${id}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reviewNote }),
  })
}

export function adjustTimeOffBalance(input: {
  memberId: string
  policyId: string
  kind: "accrual" | "adjustment"
  days: number
  effectiveOn?: string
  note?: string
}): Promise<unknown> {
  return call<unknown>("/api/time-off/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}
