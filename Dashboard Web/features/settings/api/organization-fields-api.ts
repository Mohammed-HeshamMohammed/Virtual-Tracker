import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"

const API_BASE = getApiBaseUrl()

export interface OrganizationFieldOption {
  id: string
  label: string
  position: number
}

export async function getOrganizationFieldOptions(type: string): Promise<OrganizationFieldOption[]> {
  const res = await apiFetch(`${API_BASE}/api/organization-field-options?type=${encodeURIComponent(type)}`)
  if (!res.ok) return []
  const json = (await res.json()) as { success?: boolean; options?: OrganizationFieldOption[]; data?: OrganizationFieldOption[] }
  return json.options ?? json.data ?? []
}

export async function createOrganizationFieldOption(payload: Record<string, unknown>): Promise<OrganizationFieldOption | null> {
  const res = await apiFetch(`${API_BASE}/api/organization-field-options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) return null
  const json = (await res.json()) as { success?: boolean; option?: OrganizationFieldOption; data?: OrganizationFieldOption }
  return json.option ?? json.data ?? null
}
