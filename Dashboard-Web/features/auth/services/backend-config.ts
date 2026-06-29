import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"
import type { FirebaseOptions } from "firebase/app"

let cached: FirebaseOptions | null = null
let cachedPhoneVerificationConfig: PhoneVerificationConfig | null = null

export type PhoneVerificationConfig = {
  /** Server default: console OTP in dev, Firebase SMS in production. */
  mode: "dev" | "firebase"
  /** When true, the UI may offer Firebase SMS alongside console OTP locally. */
  allowFirebaseInDev: boolean
}

export function clearFirebaseWebConfigCache(): void {
  cached = null
  cachedPhoneVerificationConfig = null
}

export async function fetchPhoneVerificationConfig(): Promise<PhoneVerificationConfig> {
  if (cachedPhoneVerificationConfig) return cachedPhoneVerificationConfig
  await prefetchSignInClientExtras()
  return cachedPhoneVerificationConfig ?? { mode: "firebase", allowFirebaseInDev: false }
}

export async function fetchPhoneVerificationMode(): Promise<"dev" | "firebase"> {
  const config = await fetchPhoneVerificationConfig()
  return config.mode
}

async function loadSignInClientExtras(): Promise<void> {
  if (cachedPhoneVerificationConfig) return
  const res = await apiFetch(apiPath("/api/auth/sign-in-client-extras"), {}, { requireAuth: false })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok || !data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    cachedPhoneVerificationConfig = { mode: "firebase", allowFirebaseInDev: false }
    return
  }
  const phoneVerificationRaw = (data as { phoneVerification?: { mode?: unknown; allowFirebaseInDev?: unknown } })
    .phoneVerification
  const modeRaw = typeof phoneVerificationRaw?.mode === "string" ? phoneVerificationRaw.mode : "firebase"
  cachedPhoneVerificationConfig = {
    mode: modeRaw === "dev" ? "dev" : "firebase",
    allowFirebaseInDev: phoneVerificationRaw?.allowFirebaseInDev === true,
  }
}

/** Dashboard-Backend sign-in UI flags (parallel with other boot calls). */
export function prefetchSignInClientExtras(): Promise<void> {
  return loadSignInClientExtras()
}

/** Auth-Backend Firebase web config (parallel with other boot calls). */
export function prefetchFirebaseWebConfig(): Promise<FirebaseOptions> {
  return fetchFirebaseWebConfigFromBackend()
}

/**
 * Fetches the public Firebase web config from Auth-Backend (not embedded in the client bundle).
 */
export async function fetchFirebaseWebConfigFromBackend(): Promise<FirebaseOptions> {
  if (cached) return cached

  const res = await apiFetch(apiPath("/api/auth/firebase-config"), {}, { requireAuth: false })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new Error(err)
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("success" in data) ||
    (data as { success: unknown }).success !== true ||
    !("config" in data) ||
    typeof (data as { config: unknown }).config !== "object" ||
    (data as { config: { apiKey?: unknown } }).config.apiKey == null
  ) {
    throw new Error("Invalid firebase-config response from API")
  }
  cached = (data as { config: FirebaseOptions }).config
  return cached
}
