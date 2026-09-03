import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { BackendPasswordRequirements } from "@/features/auth/services/password-policy/use-password-backend-check"


type ValidatePasswordResponse = {
  success?: boolean
  valid?: boolean
  error?: string
  requirements?: {
    notBlocked?: boolean
    notSimplePattern?: boolean
  }
}

function parseRequirements(data: ValidatePasswordResponse): BackendPasswordRequirements {
  const notBlocked =
    typeof data.requirements?.notBlocked === "boolean" ? data.requirements.notBlocked : null
  const notSimplePattern =
    typeof data.requirements?.notSimplePattern === "boolean" ? data.requirements.notSimplePattern : null
  return { notBlocked, notSimplePattern }
}

export type ValidatePasswordResult = {
  valid: boolean | null
  error: string | null
  requirements: BackendPasswordRequirements
  rateLimited?: boolean
  retryAfterSec?: number
}

function finalizeRequirements(
  data: ValidatePasswordResponse,
  valid: boolean,
): BackendPasswordRequirements {
  const requirements = parseRequirements(data)
  if (!valid) return requirements
  return {
    notBlocked: requirements.notBlocked ?? true,
    notSimplePattern: requirements.notSimplePattern ?? true,
  }
}

export async function validatePasswordWithBackend(
  password: string,
  confirmPassword?: string,
): Promise<ValidatePasswordResult> {
  const endpoint = apiPath("/api/auth/validate-password")
  const res = await apiFetch(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify({
        password,
        ...(typeof confirmPassword === "string" ? { confirmPassword } : {}),
      }),
    },
    { requireAuth: false, json: true },
  )

  const data = (await res.json().catch(() => ({}))) as ValidatePasswordResponse
  const requirements = parseRequirements(data)

  if (res.status === 429) {
    const retryAfterSec = Number.parseInt(res.headers.get("Retry-After") ?? "", 10)
    return {
      valid: null,
      error: null,
      requirements,
      rateLimited: true,
      retryAfterSec: Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : 2,
    }
  }

  if (!res.ok || data.success === false) {
    return {
      valid: false,
      error: typeof data.error === "string" ? data.error : "Password validation failed.",
      requirements,
    }
  }

  const valid = data.valid === true
  return {
    valid,
    error: typeof data.error === "string" ? data.error : null,
    requirements: finalizeRequirements(data, valid),
  }
}
