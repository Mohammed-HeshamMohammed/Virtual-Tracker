import { apiFetch } from "@/lib/api/http"

export type BackendPasswordRequirements = {
  notBlocked: boolean | null
  notSimplePattern: boolean | null
}

type ValidatePasswordResponse = {
  success?: boolean
  valid?: boolean
  error?: string
  requirements?: { notBlocked?: boolean; notSimplePattern?: boolean }
}

export type ValidatePasswordResult = {
  valid: boolean | null
  error: string | null
  requirements: BackendPasswordRequirements
  rateLimited?: boolean
  retryAfterSec?: number
}

function parseRequirements(data: ValidatePasswordResponse): BackendPasswordRequirements {
  return {
    notBlocked: typeof data.requirements?.notBlocked === "boolean" ? data.requirements.notBlocked : null,
    notSimplePattern: typeof data.requirements?.notSimplePattern === "boolean" ? data.requirements.notSimplePattern : null,
  }
}

/** Server-side password check before client-only Firebase operations. */
export async function validatePasswordWithBackend(password: string, confirmPassword?: string): Promise<ValidatePasswordResult> {
  const res = await apiFetch(
    "/api/auth/validate-password",
    {
      method: "POST",
      body: JSON.stringify({ password, ...(typeof confirmPassword === "string" ? { confirmPassword } : {}) }),
    },
    { requireAuth: false },
  )
  const data = (await res.json().catch(() => ({}))) as ValidatePasswordResponse
  const requirements = parseRequirements(data)

  if (res.status === 429) {
    const retryAfterSec = Number.parseInt(res.headers.get("Retry-After") ?? "", 10)
    return { valid: null, error: null, requirements, rateLimited: true, retryAfterSec: Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : 2 }
  }
  if (!res.ok || data.success === false) {
    return { valid: false, error: typeof data.error === "string" ? data.error : "Password validation failed.", requirements }
  }
  const valid = data.valid === true
  return {
    valid,
    error: typeof data.error === "string" ? data.error : null,
    requirements: valid
      ? { notBlocked: requirements.notBlocked ?? true, notSimplePattern: requirements.notSimplePattern ?? true }
      : requirements,
  }
}
