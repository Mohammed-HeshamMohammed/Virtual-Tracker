import { apiPath } from "@/infrastructure/api/path"
import { apiFetch, extractApiError } from "@/infrastructure/api/http"
import type {
  CustomerAccountSummary,
  CustomerAccountDetail,
  CreateCustomerAccountInput,
  CreateCustomerAccountResult,
  RemovalPreview,
} from "@/features/customer-accounts/models/customer-account"

const BASE = "/api/customer-accounts"

/** Thrown by the unlock endpoints and surfaced distinctly so the UI can
 *  show "N attempts left" rather than a bare error string. */
export class UnlockError extends Error {
  attemptsRemaining?: number
  constructor(message: string, attemptsRemaining?: number) {
    super(message)
    this.attemptsRemaining = attemptsRemaining
  }
}

export async function requestUnlockCode(): Promise<{ sent: boolean; expiresInMinutes: number }> {
  const res = await apiFetch(apiPath(`${BASE}/unlock/request`), { method: "POST" })
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not send verification code", json)
  }
  return { sent: json.data?.sent === true, expiresInMinutes: json.data?.expiresInMinutes ?? 10 }
}

/** Returns the unlock token to hold in component state (never persisted -
 *  see PLAN-customer-accounts-and-tenancy.md §16.3 and Phase 7: closing the
 *  tab drops it, which is what makes "closing the tab locks it again" true
 *  without any explicit lock mechanism). */
export async function verifyUnlockCode(code: string): Promise<string> {
  const res = await apiFetch(apiPath(`${BASE}/unlock/verify`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  })
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw new UnlockError(json.error || "Verification failed", json.attemptsRemaining)
  }
  return json.data?.unlockToken as string
}

function unlockHeaders(unlockToken: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Customer-Accounts-Unlock": unlockToken }
}

export async function listCustomerAccounts(): Promise<CustomerAccountSummary[]> {
  const res = await apiFetch(apiPath(BASE))
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not load customer accounts", json)
  }
  return normalizeSummaries(json.data)
}

export async function getCustomerAccountDetail(id: string): Promise<CustomerAccountDetail> {
  const res = await apiFetch(apiPath(`${BASE}/${encodeURIComponent(id)}`))
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not load this customer account", json)
  }
  return normalizeDetail(json.data)
}

export async function createCustomerAccount(
  input: CreateCustomerAccountInput,
  unlockToken: string,
): Promise<CreateCustomerAccountResult> {
  const res = await apiFetch(apiPath(BASE), {
    method: "POST",
    headers: unlockHeaders(unlockToken),
    body: JSON.stringify({ email: input.email, periodEnd: input.periodEnd, seats: input.seats, role: input.role }),
  })
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not create the customer account", json)
  }
  return {
    tenant: normalizeSummary(json.data.tenant),
    inviteUrl: json.data.inviteUrl,
    emailSent: json.data.emailSent === true,
  }
}

export async function renewCustomerAccountPeriod(
  id: string,
  periodEnd: string,
  unlockToken: string,
): Promise<void> {
  const res = await apiFetch(apiPath(`${BASE}/${encodeURIComponent(id)}/period`), {
    method: "PATCH",
    headers: unlockHeaders(unlockToken),
    body: JSON.stringify({ periodEnd }),
  })
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not renew this account", json)
  }
}

export async function changeCustomerAccountSeats(
  id: string,
  seats: number,
  unlockToken: string,
): Promise<void> {
  const res = await apiFetch(apiPath(`${BASE}/${encodeURIComponent(id)}/seats`), {
    method: "PATCH",
    headers: unlockHeaders(unlockToken),
    body: JSON.stringify({ seats }),
  })
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not change the seat limit", json)
  }
}

export async function getRemovalPreview(id: string): Promise<RemovalPreview> {
  const res = await apiFetch(apiPath(`${BASE}/${encodeURIComponent(id)}/removal-preview`))
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not load removal preview", json)
  }
  const d = json.data ?? {}
  return {
    members: Number(d.members ?? 0),
    pendingInvites: Number(d.pending_invites ?? 0),
    projects: Number(d.projects ?? 0),
    tasks: Number(d.tasks ?? 0),
    timeEntries: Number(d.time_entries ?? 0),
    screenshots: Number(d.screenshots ?? 0),
  }
}

export async function removeCustomerAccount(id: string, confirmEmail: string, unlockToken: string): Promise<void> {
  const res = await apiFetch(apiPath(`${BASE}/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: unlockHeaders(unlockToken),
    body: JSON.stringify({ confirmEmail }),
  })
  const json = await res.json()
  if (!res.ok || json.success !== true) {
    throw extractApiError(res.status, "Could not remove this account", json)
  }
}

// The backend returns snake_case columns straight from Postgres; normalized
// here at the one boundary that crosses into the web app's own camelCase
// models, same pattern the rest of this app's API layer uses.
function normalizeSummary(row: any): CustomerAccountSummary {
  return {
    id: row.id,
    email: row.email ?? "",
    grantedRole: row.granted_role,
    seatLimit: Number(row.seat_limit ?? 0),
    seatsUsed: Number(row.seats_used ?? 0),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    lifecycle: row.lifecycle,
    active: row.active === true,
    createdAt: row.created_at,
  }
}

function normalizeSummaries(rows: any): CustomerAccountSummary[] {
  return Array.isArray(rows) ? rows.map(normalizeSummary) : []
}

function normalizeDetail(row: any): CustomerAccountDetail {
  return { ...normalizeSummary(row), rootUserId: row.root_user_id ?? null }
}
