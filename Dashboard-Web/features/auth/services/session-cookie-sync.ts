import { apiFetch } from "@/infrastructure/api/http"

let syncInFlight: Promise<void> | null = null

export async function syncSharedSessionCookie(): Promise<void> {
  if (syncInFlight) return syncInFlight
  syncInFlight = syncSessionCookie().finally(() => {
    syncInFlight = null
  })
  return syncInFlight
}

async function syncSessionCookie(): Promise<void> {
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
