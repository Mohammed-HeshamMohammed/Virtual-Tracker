import { apiFetch } from "@/infrastructure/api/http"

/**
 * Mints a shared, httpOnly session cookie (scoped to the parent domain) so the
 * landing page can show an avatar instead of "Sign in" for a user who's
 * already signed into the dashboard. Best-effort — the dashboard's own
 * Bearer-token auth is unaffected either way.
 */
export async function syncSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch("/api/auth/session-cookie", { method: "POST", credentials: "include" })
  } catch {
    /* non-critical — landing page just won't show the signed-in avatar */
  }
}

/** Clears the shared session cookie on sign-out. */
export async function clearSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch(
      "/api/auth/session-logout",
      { method: "POST", credentials: "include" },
      { requireAuth: false },
    )
  } catch {
    /* non-critical */
  }
}
