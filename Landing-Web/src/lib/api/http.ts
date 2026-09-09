import { apiPath } from "@/lib/api/url"
import { getFirebaseAuthClient } from "@/lib/firebase-client"

type ApiFetchOptions = {
  requireAuth?: boolean
  forceRefresh?: boolean
}

export async function getApiAuthToken(forceRefresh = false): Promise<string | null> {
  try {
    const user = getFirebaseAuthClient().currentUser
    if (!user) return null
    return await user.getIdToken(forceRefresh)
  } catch {
    return null
  }
}

async function authHeaders(init: RequestInit, options: ApiFetchOptions): Promise<Headers> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const requireAuth = options.requireAuth !== false
  if (requireAuth && !headers.has("Authorization")) {
    const token = await getApiAuthToken(options.forceRefresh === true)
    if (!token) throw new Error("Not authenticated — sign in to call this API.")
    headers.set("Authorization", `Bearer ${token}`)
  }
  return headers
}

export async function apiFetch(path: string, init: RequestInit = {}, options: ApiFetchOptions = {}): Promise<Response> {
  const url = apiPath(path)
  const requireAuth = options.requireAuth !== false
  const headers = await authHeaders(init, options)
  let res = await fetch(url, { ...init, headers, cache: init.cache ?? "no-store" })

  if (res.status === 401 && requireAuth && options.forceRefresh !== true) {
    const retryHeaders = await authHeaders(init, { ...options, forceRefresh: true })
    res = await fetch(url, { ...init, headers: retryHeaders, cache: init.cache ?? "no-store" })
  }
  return res
}

export async function apiFetchJson<T>(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<{ res: Response; json: T | null }> {
  const res = await apiFetch(path, init, options)
  const json = (await res.json().catch(() => null)) as T | null
  return { res, json }
}
