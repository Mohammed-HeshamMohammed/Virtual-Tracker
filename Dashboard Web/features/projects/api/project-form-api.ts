import { getApiBaseUrl } from "@/infrastructure/api/url"
import { extractApiError, fetchJsonWithRetry } from "@/infrastructure/api/http"

const API_BASE = getApiBaseUrl()
type Envelope<T> = { success?: boolean; error?: string; data?: T }

export type ProjectFormTab = {
  key: string
  label: string
}

export type ProjectFormField = {
  key: string
  label: string
  type: "select" | "multiselect"
  tab: string
  placeholder?: string
  optionsSource?: "clients" | "members" | "teams"
  projectRole?: string
  roleFilter?: "manager_and_above" | "employee" | "client"
  helper?: string
  withInfo?: boolean
  budgetSubTab?: string
}

export type ProjectFormOption = {
  id: string
  label: string
  initials?: string
  role?: string
  budget?: {
    type: "hourly" | "fixed" | "retainer" | "none"
    basedOn: "per_person" | "per_project" | "total"
    cost: number
    notifyAt: number
    resets: "monthly" | "quarterly" | "yearly" | "never"
  } | null
}

export type ProjectFormConfig = {
  tabs: ProjectFormTab[]
  fields: ProjectFormField[]
  options: {
    clients: ProjectFormOption[]
    members: ProjectFormOption[]
  }
}

export async function getProjectFormConfig(): Promise<ProjectFormConfig> {
  const { res, json } = await fetchJsonWithRetry<Envelope<ProjectFormConfig>>(
    `${API_BASE}/api/projects/form-config`,
    {},
    { retries: 1 },
  )
  if (!res.ok) throw extractApiError(res.status, "Failed to load project form", json)
  if (!json?.success || !json.data) throw new Error(json?.error || "Failed to load project form")
  return json.data
}
