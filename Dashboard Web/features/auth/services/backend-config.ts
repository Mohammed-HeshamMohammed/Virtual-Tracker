import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"
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
  await fetchFirebaseWebConfigFromBackend()
  return cachedPhoneVerificationConfig ?? { mode: "firebase", allowFirebaseInDev: false }
}

export async function fetchPhoneVerificationMode(): Promise<"dev" | "firebase"> {
  const config = await fetchPhoneVerificationConfig()
  return config.mode
}

/**
 * Fetches the public Firebase web config from the Backend (not embedded in the client bundle as secrets).
 * Same values the Firebase client SDK would read from `NEXT_PUBLIC_*` in a monolithic app.
 */
export async function fetchFirebaseWebConfigFromBackend(): Promise<FirebaseOptions> {
  if (cached) return cached

  const res = await apiFetch(`${getApiBaseUrl()}/api/auth/firebase-config`, {}, { requireAuth: false })
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
  const phoneVerificationRaw =
    data && typeof data === "object" && "phoneVerification" in data
      ? (data as { phoneVerification?: { mode?: unknown; allowFirebaseInDev?: unknown } }).phoneVerification
      : undefined
  const modeRaw = typeof phoneVerificationRaw?.mode === "string" ? phoneVerificationRaw.mode : "firebase"
  cachedPhoneVerificationConfig = {
    mode: modeRaw === "dev" ? "dev" : "firebase",
    allowFirebaseInDev: phoneVerificationRaw?.allowFirebaseInDev === true,
  }
  return cached
}
