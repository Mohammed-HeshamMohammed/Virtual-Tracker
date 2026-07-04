import { apiFetch } from "@/infrastructure/api/http"

/** Shared httpOnly session cookie for landing↔dashboard avatar hint (best-effort). */
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
