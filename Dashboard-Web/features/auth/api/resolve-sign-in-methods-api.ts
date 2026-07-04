import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"

export type ResolvedIdentity = {
  provider: string
  identifier: string | null
  federatedUid?: string | null
}

export type ResolveSignInMethodsResponse =
  | {
      success: true
      methods: string[]
      identities: ResolvedIdentity[]
    }
  | { success: false; error: string; code?: string }

/** Sign-in methods from backend Admin + client SDK merge. */
export async function resolveSignInMethodsFromApi(email: string): Promise<ResolveSignInMethodsResponse | null> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return null
  try {
    const res = await apiFetch(
      apiPath("/api/auth/resolve-sign-in-methods"),
      {
        method: "POST",
        body: JSON.stringify({ email: trimmed }),
      },
      { requireAuth: false, json: true },
    )
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (data && typeof data === "object") {
        const err = data as { error?: unknown; code?: unknown }
        if (typeof err.error === "string" && err.error.trim()) {
          return {
            success: false,
            error: err.error,
            code: typeof err.code === "string" ? err.code : undefined,
          }
        }
      }
      return null
    }
    if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
      return null
    }
    return data as ResolveSignInMethodsResponse
  } catch {
    return null
  }
}
