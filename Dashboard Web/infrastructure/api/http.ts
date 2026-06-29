/* eslint-disable react-doctor/async-await-in-loop */
import { bearerAuthHeaders } from "@/features/auth/services/bearer-headers"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"
import {
  isAccountRestrictionCode,
  parseAuthSessionErrorCode,
  parseAuthSessionErrorMessage,
  VT_AUTH_SESSION_RESTRICTED,
} from "@/features/auth/services/auth-session-errors"
import {
  BACKEND_TEMPORARILY_UNAVAILABLE_MESSAGE,
  isApiConnectionFailureStatus,
  isApiConnectionNetworkError,
  notifyBackendConnectionLost,
  notifyBackendConnectionRestored,
} from "@/infrastructure/api/backend-connection-events"
import { apiPath } from "@/infrastructure/api/path"
import { resolveApiBaseUrlForPath } from "@/infrastructure/api/url"
import { assertSecureFetchUrl } from "@/infrastructure/api/secure-transport"

export type RequestOptions = {
  signal?: AbortSignal
  retries?: number
  /** Default true — set false for public routes (invite register, etc.). */
  requireAuth?: boolean
}

export type ApiFetchOptions = {
  /** Set Content-Type: application/json when sending a body. */
  json?: boolean
  requireAuth?: boolean
  /** Internal — forces a fresh Firebase ID token (401 retry). */
  forceRefresh?: boolean
}

/** Standard Backend JSON envelope (`compat`, `schema`, feature routes). */
export type ApiEnvelope<T> = {
  success?: boolean
  error?: string
  errorDetail?: {
    code?: string
    message?: string
  }
  data?: T
  members?: T
  member?: T
  invites?: T
  invite?: T
  options?: T
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

export function pickEnvelopePayload<T>(json: ApiEnvelope<T> | null | undefined): T | undefined {
  if (!json) return undefined
  return json.data ?? json.member ?? json.members ?? json.invite ?? json.invites ?? json.options
}

export async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function extractApiError(
  status: number,
  fallback: string,
  body?: { error?: string; errorDetail?: { message?: string } } | null,
): Error {
  const message =
    body?.errorDetail?.message?.trim() || body?.error?.trim() || `${fallback}: ${status}`
  return new Error(message)
}

export async function getApiAuthToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const user = getFirebaseAuth().currentUser
    if (!user) return null
    return user.getIdToken(forceRefresh)
  } catch {
    return null
  }
}

/** Merge Firebase Bearer token into request headers (browser only). */
export async function apiAuthHeaders(
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Headers> {
  const headers = new Headers(init.headers)
  const json = options.json ?? Boolean(init.body)
  if (json && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const requireAuth = options.requireAuth !== false
  if (requireAuth && !headers.has("Authorization")) {
    const token = await getApiAuthToken(options.forceRefresh === true)
    if (!token) {
      throw new Error("Not authenticated — sign in to call this API.")
    }
    for (const [key, value] of Object.entries(bearerAuthHeaders(token))) {
      headers.set(key, String(value))
    }
  }
  return headers
}

async function maybeNotifyAuthSessionRestricted(res: Response): Promise<void> {
  if (typeof window === "undefined") return
  if (res.status !== 401 && res.status !== 403) return
  try {
    const data = await res.clone().json()
    const code = parseAuthSessionErrorCode(data)
    if (!isAccountRestrictionCode(code)) return
    window.dispatchEvent(
      new CustomEvent(VT_AUTH_SESSION_RESTRICTED, {
        detail: {
          code,
          message: parseAuthSessionErrorMessage(data, "Your account access has been restricted."),
        },
      }),
    )
  } catch {
    /* ignore non-json auth responses */
  }
}

async function performApiFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  headers: Headers,
): Promise<Response> {
  try {
    const res = await fetch(input, {
      ...init,
      headers,
      signal: init.signal,
      credentials: init.credentials ?? "same-origin",
      cache: init.cache ?? "no-store",
    })
    if (isApiConnectionFailureStatus(res.status)) {
      notifyBackendConnectionLost(
        res.status === 503 ? BACKEND_TEMPORARILY_UNAVAILABLE_MESSAGE : undefined,
      )
    } else if (res.ok) {
      notifyBackendConnectionRestored()
    } else {
      await maybeNotifyAuthSessionRestricted(res)
    }
    return res
  } catch (error) {
    if (isApiConnectionNetworkError(error)) {
      notifyBackendConnectionLost()
    }
    throw error
  }
}

function normalizeApiFetchInput(input: RequestInfo | URL): RequestInfo | URL {
  const urlStr = resolveRequestUrl(input);
  if (urlStr.startsWith("/api/")) {
    return apiPath(urlStr);
  }

  try {
    const parsed = new URL(urlStr);
    if (!parsed.pathname.startsWith("/api/")) return input;
    const targetBase = resolveApiBaseUrlForPath(parsed.pathname);
    if (parsed.origin === new URL(targetBase).origin) return input;
    return `${targetBase}${parsed.pathname}${parsed.search}`;
  } catch {
    return input;
  }
}

/** `fetch` with API base paths, HTTPS validation, and optional Firebase auth (default on). */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const resolvedInput = normalizeApiFetchInput(input);
  assertSecureFetchUrl(resolveRequestUrl(resolvedInput))
  const requireAuth = options.requireAuth !== false
  const headers = await apiAuthHeaders(init, options)
  let res = await performApiFetch(resolvedInput, init, headers)

  if (res.status === 401 && requireAuth && options.forceRefresh !== true) {
    const retryHeaders = await apiAuthHeaders(init, { ...options, forceRefresh: true })
    res = await performApiFetch(resolvedInput, init, retryHeaders)
  }

  return res
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<{ res: Response; json: T | null }> {
  const retries = Math.max(0, options.retries ?? 0)
  const requireAuth = options.requireAuth !== false
  let attempt = 0
  while (true) {
    try {
      const res = await apiFetch(input, init, {
        json: Boolean(init.body),
        requireAuth,
      })
      const json = await readJsonSafe<T>(res)
      return { res, json }
    } catch (error) {
      if (options.signal?.aborted || attempt >= retries) throw error
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
}
