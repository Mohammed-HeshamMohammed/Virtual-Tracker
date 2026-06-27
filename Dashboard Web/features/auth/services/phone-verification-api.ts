import { getApiBaseUrl } from "@/infrastructure/api/url"
import { apiFetch, getApiAuthToken } from "@/infrastructure/api/http"
import { bearerAuthHeaders } from "@/features/auth/services/bearer-headers"

const API_BASE = getApiBaseUrl()

type ApiEnvelope<T> = {
  success?: boolean
  error?: string
  data?: T
}

async function optionalSessionAuthInit(body: string): Promise<RequestInit> {
  const init: RequestInit = { method: "POST", body }
  const sessionToken = await getApiAuthToken()
  if (sessionToken) {
    init.headers = bearerAuthHeaders(sessionToken)
  }
  return init
}

export async function sendPhoneVerificationCode(phone: string): Promise<{ challengeId: string; expiresInSeconds: number }> {
  const res = await apiFetch(
    `${API_BASE}/api/auth/phone-verification/send`,
    await optionalSessionAuthInit(JSON.stringify({ phone: phone.trim() })),
    { requireAuth: false, json: true },
  )
  const json = (await res.json()) as ApiEnvelope<{ challengeId: string; expiresInSeconds: number }>
  if (!res.ok || !json.success || !json.data?.challengeId) {
    throw new Error(json.error || "Could not send verification code.")
  }
  return json.data
}

export async function confirmPhoneVerificationCode(
  challengeId: string,
  code: string,
): Promise<{ verificationToken: string; phone: string; expiresInSeconds: number }> {
  const res = await apiFetch(
    `${API_BASE}/api/auth/phone-verification/confirm`,
    await optionalSessionAuthInit(JSON.stringify({ challengeId, code: code.trim() })),
    { requireAuth: false, json: true },
  )
  const json = (await res.json()) as ApiEnvelope<{ verificationToken: string; phone: string; expiresInSeconds: number }>
  if (!res.ok || !json.success || !json.data?.verificationToken) {
    throw new Error(json.error || "Verification failed.")
  }
  return json.data
}

/** Compare phone numbers loosely (digits-only, last 10). */
export function phoneNumbersMatch(a: string, b: string): boolean {
  const left = a.replace(/\D/g, "")
  const right = b.replace(/\D/g, "")
  if (!left || !right) return false
  if (left === right) return true
  if (left.length >= 10 && right.length >= 10) return left.slice(-10) === right.slice(-10)
  return false
}

/** Normalize user input to E.164 for Firebase SMS (US + Egypt friendly). */
export function formatPhoneE164(phone: string): string {
  const trimmed = phone.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`
  }
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length === 11 && digits.startsWith("0")) return `+20${digits.slice(1)}`
  return `+${digits}`
}

export async function exchangeFirebasePhoneVerification(
  idToken: string,
  phone: string,
): Promise<{ verificationToken: string; phone: string; expiresInSeconds: number }> {
  const res = await apiFetch(
    `${API_BASE}/api/auth/phone-verification/exchange`,
    await optionalSessionAuthInit(JSON.stringify({ idToken: idToken.trim(), phone: phone.trim() })),
    { requireAuth: false, json: true },
  )
  const json = (await res.json()) as ApiEnvelope<{ verificationToken: string; phone: string; expiresInSeconds: number }>
  if (!res.ok || !json.success || !json.data?.verificationToken) {
    throw new Error(json.error || "Verification failed.")
  }
  return json.data
}
