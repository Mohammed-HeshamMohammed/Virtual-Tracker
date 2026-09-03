import { extractApiError, readJsonSafe, apiFetch, fetchJsonWithRetry, type ApiEnvelope } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { resolveCurrentMemberId } from "@/features/members/services/current-member"
import { isValidUuid } from "@/shared/utils/uuid"
import type { ClientEditLoadedState, ClientFormData } from "@/features/clients/models/client"

export interface Client {
  id: string
  status: "active" | "archived"
  name: string
  address: string
  city?: string
  state?: string
  zip?: string
  country?: string
  phone: string
  email: string
  clientMember: string
  projects: string[]
  budget: ClientBudget | null
  invoicing: ClientInvoicing
  budgetId?: string
  invoicingId?: string
  updatedAt?: string
}

export interface ClientBudget {
  type: "hourly" | "fixed" | "retainer" | "none"
  basedOn: "per_person" | "per_project" | "total"
  cost: number
  notifyAt: number
  resets: "monthly" | "quarterly" | "yearly" | "never"
}

export interface ClientInvoicing {
  custom: boolean
  notes: string
  netTerms: number
  taxRate: number
  autoInvoicing: boolean
  autoAmountBasis: "hourly" | "fixed"
  autoFixedAmount: number
  autoFrequency: "weekly" | "biweekly" | "monthly"
  autoDelaySending: number
  autoReminderDays: number
  autoLineItems: string
  autoIncludeNonBillable: boolean
  autoIncludeExpenses: boolean
}

export type ClientInvoicingSettings = {
  source: "global" | "client" | "client-auto"
  settings: ClientInvoicing
  clientId: string
}

function buildDetailsBody(
  data: ClientFormData,
  options?: { budgetId?: string; invoicingId?: string; expectedUpdatedAt?: string },
  actorMemberId?: string,
): Record<string, unknown> {
  return {
    ...data,
    budgetId: options?.budgetId ?? data.budgetId,
    invoicingId: options?.invoicingId ?? data.invoicingId,
    ...(actorMemberId ? { actorMemberId } : {}),
    ...(options?.expectedUpdatedAt ? { expected_updated_at: options.expectedUpdatedAt } : {}),
  }
}

export async function getClients(): Promise<Client[]> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Client[]>>(
    apiPath("/api/clients/enriched"),
    {},
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch clients", json)
  if (!json?.success || !Array.isArray(json.data)) {
    throw new Error(json?.error || "Failed to fetch clients")
  }
  return json.data
}

export async function fetchClientForEdit(clientId: string): Promise<Client> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<Client>>(
    apiPath(`/api/clients/${encodeURIComponent(clientId)}/edit-state`),
    {},
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch client", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to fetch client")
  return json.data
}

async function getClient(id: string): Promise<Client> {
  return fetchClientForEdit(id)
}

async function getClientInvoicingSettings(clientId: string): Promise<ClientInvoicingSettings> {
  const { res, json } = await fetchJsonWithRetry<ApiEnvelope<ClientInvoicingSettings>>(
    apiPath(`/api/clients/${encodeURIComponent(clientId)}/invoicing`),
    {},
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to fetch client invoicing", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to fetch client invoicing")
  return json.data
}

export async function createClientWithDetails(
  data: ClientFormData,
  userId?: string,
): Promise<Client> {
  const actorId = userId && isValidUuid(userId) ? userId : await resolveCurrentMemberId()
  const res = await apiFetch(apiPath("/api/clients/with-details"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDetailsBody(data, undefined, actorId)),
  })
  const json = await readJsonSafe<ApiEnvelope<Client>>(res)
  if (!res.ok) throw extractApiError(res.status, "Failed to create client", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to create client")
  return json.data
}

export async function updateClientWithDetails(
  clientId: string,
  data: ClientFormData,
  options?: { budgetId?: string; invoicingId?: string; expectedUpdatedAt?: string },
  actorMemberId?: string,
): Promise<Client> {
  const actorId =
    actorMemberId && isValidUuid(actorMemberId) ? actorMemberId : await resolveCurrentMemberId()
  const res = await apiFetch(apiPath(`/api/clients/${encodeURIComponent(clientId)}/with-details`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDetailsBody(data, options, actorId)),
  })
  const json = await readJsonSafe<ApiEnvelope<Client>>(res)
  if (!res.ok) {
    const err = extractApiError(res.status, "Failed to update client", json) as Error & {
      status?: number
      conflictData?: unknown
    }
    err.status = res.status
    if (res.status === 409) err.conflictData = json?.data
    throw err
  }
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to update client")
  return json.data
}

export async function updateClient(
  id: string,
  data: Partial<Client> & Partial<ClientFormData>,
  actorMemberId?: string,
): Promise<Client> {
  const actorId =
    actorMemberId && isValidUuid(actorMemberId) ? actorMemberId : await resolveCurrentMemberId()
  const body: Record<string, unknown> = {}
  if (data.name !== undefined) body.name = String(data.name).trim()
  if (data.clientMember !== undefined && isValidUuid(data.clientMember)) {
    body.member_id = data.clientMember
  }
  if (data.address !== undefined) body.street_address = data.address
  if (data.city !== undefined) body.city = data.city
  if (data.state !== undefined) body.state = data.state
  if (data.zip !== undefined) body.zip = data.zip
  if (data.country !== undefined) body.country = data.country
  if (data.phone !== undefined) body.phone_number = data.phone
  if (data.email !== undefined) body.email_addresses = data.email
  if (data.status !== undefined) body.status = data.status
  if (actorId) body.updated_by = actorId

  const res = await apiFetch(apiPath(`/api/clients/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await readJsonSafe<ApiEnvelope<Client>>(res)
  if (!res.ok) throw extractApiError(res.status, "Failed to update client", json)
  if (!json?.success) throw new Error(json?.error || "Failed to update client")
  return getClient(id)
}

export async function deleteClient(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/clients/${id}`), { method: "DELETE" })
  if (!res.ok) throw new Error(`Failed to delete client: ${res.status}`)
}
