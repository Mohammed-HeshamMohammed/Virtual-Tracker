import { apiFetch } from "@/infrastructure/api/http"
import { getApiBaseUrl } from "@/infrastructure/api/url"
import { FALLBACK_PASSWORD_POLICY } from "@/features/auth/services/password-policy/defaults"
import type { PasswordPolicyResponse } from "@/features/auth/services/password-policy/types"

const SESSION_CACHE_KEY = "vt:password-policy:v1"

type CachedPolicy = PasswordPolicyResponse & { cachedAt: number }

let memoryCache: PasswordPolicyResponse | null = null
let inFlight: Promise<PasswordPolicyResponse> | null = null

function readSessionCache(): PasswordPolicyResponse | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedPolicy
    if (!parsed?.passwordPolicy || typeof parsed.version !== "string") return null
    return {
      version: parsed.version,
      lastUpdated: parsed.lastUpdated,
      passwordPolicy: parsed.passwordPolicy,
    }
  } catch {
    return null
  }
}

function writeSessionCache(policy: PasswordPolicyResponse): void {
  if (typeof window === "undefined") return
  try {
    const payload: CachedPolicy = { ...policy, cachedAt: Date.now() }
    window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore quota or privacy mode errors.
  }
}

export function getCachedPasswordPolicy(): PasswordPolicyResponse | null {
  return memoryCache ?? readSessionCache()
}

async function fetchPasswordPolicyFromNetwork(): Promise<PasswordPolicyResponse> {
  const endpoint = `${getApiBaseUrl()}/api/auth/password-policy`
  const res = await apiFetch(endpoint, { method: "GET" }, { requireAuth: false })
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean
    version?: string
    lastUpdated?: string
    passwordPolicy?: PasswordPolicyResponse["passwordPolicy"]
  }

  if (!res.ok || data.success === false || !data.passwordPolicy) {
    throw new Error("Password policy unavailable")
  }

  return {
    version: typeof data.version === "string" ? data.version : FALLBACK_PASSWORD_POLICY.version,
    lastUpdated:
      typeof data.lastUpdated === "string" ? data.lastUpdated : FALLBACK_PASSWORD_POLICY.lastUpdated,
    passwordPolicy: data.passwordPolicy,
  }
}

export async function fetchPasswordPolicy(): Promise<PasswordPolicyResponse> {
  if (memoryCache) return memoryCache
  if (inFlight) return inFlight

  inFlight = (async () => {
    const sessionCached = readSessionCache()
    if (sessionCached) {
      memoryCache = sessionCached
      return sessionCached
    }

    try {
      const policy = await fetchPasswordPolicyFromNetwork()
      memoryCache = policy
      writeSessionCache(policy)
      return policy
    } catch {
      const fallback = FALLBACK_PASSWORD_POLICY
      memoryCache = fallback
      return fallback
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
