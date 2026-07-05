import { apiFetch } from "@/lib/api/http"

export type ResolvedIdentity = { provider: string; identifier: string | null }

export type ResolveSignInMethodsResponse =
  | { success: true; methods: string[]; identities: ResolvedIdentity[] }
  | { success: false; error: string }

/**
 * Uses the backend (Firebase Admin) to read the same provider rows as in Firebase Auth,
 * then merges with the client SDK list where needed.
 */
export async function resolveSignInMethodsFromApi(email: string): Promise<ResolveSignInMethodsResponse | null> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return null
  try {
    const res = await apiFetch(
      "/api/auth/resolve-sign-in-methods",
      { method: "POST", body: JSON.stringify({ email: trimmed }) },
      { requireAuth: false },
    )
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
        return { success: false, error: (data as { error: string }).error }
      }
      return null
    }
    if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) return null
    return data as ResolveSignInMethodsResponse
  } catch {
    return null
  }
}
