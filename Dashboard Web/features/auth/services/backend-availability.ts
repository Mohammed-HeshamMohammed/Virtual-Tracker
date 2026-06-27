import { BACKEND_UNAVAILABLE_MESSAGE } from "@/infrastructure/api/backend-connection-events"
import { apiPath } from "@/infrastructure/api/path"
import { apiFetch } from "@/infrastructure/api/http"

export type BackendReadiness =
  | { ok: true }
  | { ok: false; code: string; error: string }

function parseReadinessFailure(
  status: number,
  data: unknown,
): { code: string; error: string } {
  const error =
    data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${status}`
  const code =
    data && typeof data === "object" && "code" in data && typeof (data as { code: unknown }).code === "string"
      ? (data as { code: string }).code
      : status === 503
        ? "SERVICE_UNAVAILABLE"
        : "UNREACHABLE"
  return { code, error }
}

/** True when Auth-Backend and Firebase Admin are reachable. */
export async function checkBackendReadiness(signal?: AbortSignal): Promise<BackendReadiness> {
  try {
    const url = apiPath("/api/auth/readiness")
    const res = await apiFetch(url, { signal }, { requireAuth: false })
    const data: unknown = await res.json().catch(() => null)
    if (
      res.ok &&
      data &&
      typeof data === "object" &&
      "success" in data &&
      (data as { success: unknown }).success === true
    ) {
      return { ok: true }
    }
    return { ok: false, ...parseReadinessFailure(res.status, data) }
  } catch {
    return {
      ok: false,
      code: "UNREACHABLE",
      error: BACKEND_UNAVAILABLE_MESSAGE,
    }
  }
}

/** True when Dashboard-Backend and Firestore are reachable for identity bootstrap. */
export async function checkDashboardReadiness(signal?: AbortSignal): Promise<BackendReadiness> {
  try {
    const url = apiPath("/api/readiness")
    const res = await apiFetch(url, { signal }, { requireAuth: false })
    const data: unknown = await res.json().catch(() => null)
    if (
      res.ok &&
      data &&
      typeof data === "object" &&
      "success" in data &&
      (data as { success: unknown }).success === true
    ) {
      return { ok: true }
    }
    return { ok: false, ...parseReadinessFailure(res.status, data) }
  } catch {
    return {
      ok: false,
      code: "UNREACHABLE",
      error: BACKEND_UNAVAILABLE_MESSAGE,
    }
  }
}

/** True when both Auth and Dashboard APIs pass readiness probes. */
export async function checkAllBackendsReady(signal?: AbortSignal): Promise<BackendReadiness> {
  const [auth, dashboard] = await Promise.all([
    checkBackendReadiness(signal),
    checkDashboardReadiness(signal),
  ])
  if (!auth.ok) return auth
  if (!dashboard.ok) return dashboard
  return { ok: true }
}

/** True when Auth-Backend is reachable and can serve Firebase web config. */
export async function checkBackendAvailable(signal?: AbortSignal): Promise<boolean> {
  const readiness = await checkAllBackendsReady(signal)
  return readiness.ok
}
