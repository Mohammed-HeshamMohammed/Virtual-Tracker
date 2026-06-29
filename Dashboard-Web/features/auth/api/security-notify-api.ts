import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"

export async function notifyPasswordChanged(): Promise<void> {
  try {
    await apiFetch(apiPath("/api/auth/notify-password-changed"), {
      method: "POST",
      body: JSON.stringify({}),
    })
  } catch {
    /* non-blocking security notification */
  }
}

export async function notifyPasswordResetCompleted(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return
  try {
    await apiFetch(apiPath("/api/auth/notify-password-reset"), {
      method: "POST",
      body: JSON.stringify({ email: normalized }),
    })
  } catch {
    /* non-blocking security notification */
  }
}

export async function notifyEmailVerified(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return
  try {
    await apiFetch(apiPath("/api/auth/notify-email-verified"), {
      method: "POST",
      body: JSON.stringify({ email: normalized }),
    })
  } catch {
    /* non-blocking welcome notification */
  }
}
