import { apiFetch } from "@/lib/api/http"

export async function syncSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch("/api/auth/session-cookie", { method: "POST", credentials: "include" })
  } catch {
    /* non-critical */
  }
}

export async function clearSharedSessionCookie(): Promise<void> {
  try {
    await apiFetch("/api/auth/session-logout", { method: "POST", credentials: "include" }, { requireAuth: false })
  } catch {
    /* non-critical */
  }
}
