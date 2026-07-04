import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { User } from "firebase/auth"
import { parseAuthProfileSnapshot, type AuthProfileSnapshot } from "@/features/auth/services/verify-session"

export type PatchProfileSettingsPayload = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  phoneVerificationToken?: string
}

/** PATCH User_profiles + optional Auth displayName from first/last. */
export async function patchProfileSettingsWithBackend(
  user: User,
  payload: PatchProfileSettingsPayload,
): Promise<AuthProfileSnapshot | undefined> {
  void user
  const res = await apiFetch(apiPath("/api/auth/profile"), {
    method: "POST",
    body: JSON.stringify(payload),
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const raw =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(raw)
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid profile response")
  }
  return parseAuthProfileSnapshot((data as { profile?: unknown }).profile)
}
