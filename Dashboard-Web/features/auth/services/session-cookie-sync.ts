import { apiFetch } from "@/infrastructure/api/http"

export async function syncSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch("/api/auth/session-cookie", { method: "POST", credentials: "include" })
  } catch {
    /* non-critical — landing page just won't show the signed-in avatar */
  }
}

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
