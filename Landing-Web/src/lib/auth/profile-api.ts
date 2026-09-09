import { apiFetch } from "@/lib/api/http"
import { parseAuthProfileSnapshot, type AuthProfileSnapshot } from "@/lib/auth/verify-session"

export type PatchProfileSettingsPayload = {
  firstName?: string
  lastName?: string
  phone?: string
}

export async function patchProfileSettingsWithBackend(payload: PatchProfileSettingsPayload): Promise<AuthProfileSnapshot | undefined> {
  const res = await apiFetch("/api/auth/profile", { method: "POST", body: JSON.stringify(payload) })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const raw =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(raw)
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid profile response")
  }
  return parseAuthProfileSnapshot((data as { profile?: unknown }).profile)
}

