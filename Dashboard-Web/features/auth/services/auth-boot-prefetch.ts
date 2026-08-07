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

/** Parallel auth boot — readiness + config/policy in one round. */
export async function prefetchAuthBootResources(signal?: AbortSignal): Promise<BackendReadiness> {
  const [authReadiness, dashboardReadiness, firebaseConfig] = await Promise.all([
    checkBackendReadiness(signal),
    checkDashboardReadiness(signal),
    prefetchFirebaseWebConfig().then(
      () => ({ ok: true as const }),
      (e) => ({
        ok: false as const,
        code: "UNREACHABLE",
        error: e instanceof Error ? e.message : "Firebase config unavailable",
      }),
    ),
    fetchPasswordPolicy(),
    prefetchSignInClientExtras(),
  ])
  if (!authReadiness.ok) return authReadiness
  if (!dashboardReadiness.ok) return dashboardReadiness
  if (!firebaseConfig.ok) return firebaseConfig
  return { ok: true }
}
