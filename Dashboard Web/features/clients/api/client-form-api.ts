import { apiPath } from "@/infrastructure/api/path"
import { extractApiError, fetchJsonWithRetry } from "@/infrastructure/api/http"

type Envelope<T> = { success?: boolean; error?: string; data?: T }

export type ClientFormTab = {
  key: string
  label: string
}

export type ClientFormField = {
  key: string
  label: string
  type: string
  tab: string
  placeholder?: string
  optionsSource?: string
  optionsKey?: string
}

export type ClientFormOption = {
  value?: string
  id?: string
  label: string
  initials?: string
}

export type ClientFormConfig = {
  tabs: ClientFormTab[]
  fields: ClientFormField[]
  options: {
    budgetTypes: ClientFormOption[]
    budgetBases: ClientFormOption[]
    budgetResets: ClientFormOption[]
    frequencies: ClientFormOption[]
    amountBasis: ClientFormOption[]
    lineItems: ClientFormOption[]
    clientMembers: ClientFormOption[]
    projects: ClientFormOption[]
  }
}

export async function getClientFormConfig(): Promise<ClientFormConfig> {
  const { res, json } = await fetchJsonWithRetry<Envelope<ClientFormConfig>>(
    apiPath("/api/clients/form-config"),
    {},
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to load client form", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to load client form")
  return json.data
}
