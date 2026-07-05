import { apiFetch } from "@/lib/api/http"

/**
 * Mints the shared, httpOnly session cookie (scoped to the parent domain) so
 * Dashboard-Web also shows this user as signed in. Best-effort.
 */
export async function syncSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch("/api/auth/session-cookie", { method: "POST", credentials: "include" })
  } catch {
    /* non-critical */
  }
}

/** Clears the shared session cookie on sign-out. */
export async function clearSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch("/api/auth/session-logout", { method: "POST", credentials: "include" }, { requireAuth: false })
  } catch {
    /* non-critical */
  }
}
