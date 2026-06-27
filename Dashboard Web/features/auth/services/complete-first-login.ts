import { apiFetch } from "@/infrastructure/api/http"
import { getAuthApiBaseUrl } from "@/infrastructure/api/url"
import { parseAuthProfileSnapshot, type AuthProfileSnapshot } from "@/features/auth/services/verify-session"

export type CompleteFirstLoginInput = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export type CompleteFirstLoginResult = {
  requireSignIn: boolean
  promoted: boolean
  memberId: string | null
  profile?: AuthProfileSnapshot
}

/**
 * Server-side first-login password change: verifies temp password, updates Auth, promotes pending member, clears flags.
 */
export async function completeFirstLoginWithBackend(
  input: CompleteFirstLoginInput,
): Promise<CompleteFirstLoginResult> {
  const res = await apiFetch(`${getAuthApiBaseUrl()}/api/auth/complete-first-login`, {
    method: "POST",
    body: JSON.stringify({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      confirmPassword: input.confirmPassword,
    }),
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(err)
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    throw new Error("Invalid complete-first-login response")
  }
  const payload = data as {
    requireSignIn?: unknown
    promoted?: unknown
    memberId?: unknown
    profile?: unknown
  }
  return {
    requireSignIn: payload.requireSignIn === true,
    promoted: payload.promoted === true,
    memberId: typeof payload.memberId === "string" ? payload.memberId : null,
    profile: parseAuthProfileSnapshot(payload.profile),
  }
}
