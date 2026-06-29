import {
  checkAllBackendsReady,
  checkBackendReadiness,
  checkDashboardReadiness,
  type BackendReadiness,
} from "@/features/auth/services/backend-availability"
import {
  prefetchFirebaseWebConfig,
  prefetchSignInClientExtras,
} from "@/features/auth/services/backend-config"
import { fetchPasswordPolicy } from "@/features/auth/services/password-policy/fetch-policy"

/**
 * Parallel auth boot — readiness + stable config/policy/extras in one wall-clock round.
 * Firebase `initFirebase()` runs after this (needs cached web config).
 */
export async function prefetchAuthBootResources(signal?: AbortSignal): Promise<BackendReadiness> {
  const [authReadiness, dashboardReadiness] = await Promise.all([
    checkBackendReadiness(signal),
    checkDashboardReadiness(signal),
    prefetchFirebaseWebConfig(),
    fetchPasswordPolicy(),
    prefetchSignInClientExtras(),
  ])
  if (!authReadiness.ok) return authReadiness
  if (!dashboardReadiness.ok) return dashboardReadiness
  return { ok: true }
}
