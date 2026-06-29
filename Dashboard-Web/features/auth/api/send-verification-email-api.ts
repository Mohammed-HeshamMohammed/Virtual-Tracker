import { apiFetch, readJsonSafe } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import { logSafeWarn } from "@/infrastructure/logging/logger"

type SendVerificationEmailResponse = {
  success?: boolean
  sent?: boolean
  channel?: string
  code?: string
  error?: string
}

export type SendVerificationEmailResult =
  | { delivered: true; channel: string }
  | { delivered: false; code: "EMAIL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED" | "REQUEST_FAILED"; error?: string }

export async function sendVerificationEmailWithBackend(
  continueUrl: string,
): Promise<SendVerificationEmailResult> {
  const endpoint = apiPath("/api/auth/send-verification-email")
  try {
    const res = await apiFetch(
      endpoint,
      {
        method: "POST",
        body: JSON.stringify({
          ...(continueUrl ? { continueUrl } : {}),
        }),
      },
      { requireAuth: true, json: true },
    )
    const data = await readJsonSafe<SendVerificationEmailResponse>(res)
    if (res.ok && data?.sent) {
      return { delivered: true, channel: data.channel ?? "backend" }
    }
    if (data?.code === "EMAIL_NOT_CONFIGURED") {
      return { delivered: false, code: "EMAIL_NOT_CONFIGURED", error: data.error }
    }
    return {
      delivered: false,
      code: "EMAIL_SEND_FAILED",
      error: data?.error ?? "Could not send verification email.",
    }
  } catch (err) {
    logSafeWarn("[auth/send-verification-email-api]", err)
    return {
      delivered: false,
      code: "REQUEST_FAILED",
      error: err instanceof Error ? err.message : "Could not reach the server.",
    }
  }
}
