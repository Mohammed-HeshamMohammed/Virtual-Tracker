import { apiFetch } from "@/lib/api/http"
import { parseAuthProfileSnapshot, type AuthProfileSnapshot } from "@/lib/auth/verify-session"

export type PatchProfileSettingsPayload = {
  firstName?: string
  lastName?: string
  phone?: string
}

/** Merges editable profile fields into Firestore `User_profiles/{uid}` (Dashboard-Backend). */
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

// Note: there is no GET /api/auth/profile — Dashboard-Backend only exposes the
// PATCH-style POST above. Reading the current profile is done via the `profile`
// field already returned by session-bootstrap (see verify-session.ts /
// use-current-user.ts), not a separate fetch.
