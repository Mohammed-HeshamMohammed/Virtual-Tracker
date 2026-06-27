import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"

export type AccessRequestBody = { name: string; email: string; phone: string }

export async function submitAccessRequest(body: AccessRequestBody): Promise<{ id: string }> {
  const res = await apiFetch(
    `${getApiBaseUrl()}/api/auth/access-request`,
    {
      method: "POST",
      body: JSON.stringify({ name: body.name, email: body.email, phone: body.phone }),
    },
    { requireAuth: false, json: true },
  )
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(err)
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid response")
  }
  const id = (data as { data?: { id?: string } }).data?.id
  if (typeof id !== "string") throw new Error("Missing request id")
  return { id }
}
