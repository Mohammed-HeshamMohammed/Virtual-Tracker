import { getApiBaseUrl } from "@/infrastructure/api/url"
import { apiFetch, extractApiError, readJsonSafe } from "@/infrastructure/api/http"
import { retryWithBackoff } from "@/infrastructure/api/retry"
import { DASHBOARD_FETCH_RETRY } from "@/infrastructure/api/auth-retry"
import type { CommandCenterApiPayload } from "@/features/dashboard/components/command-center/constants"
import { logSafeWarn } from "@/infrastructure/logging/logger"

const API_BASE = getApiBaseUrl()

type Envelope = { success?: boolean; error?: string; data?: CommandCenterApiPayload }

let cached: { at: number; data: CommandCenterApiPayload } | null = null
const CACHE_TTL_MS = 60_000

export function invalidateCommandCenterCache(): void {
  cached = null
}

export async function fetchCommandCenterData(options?: {
  force?: boolean
  signal?: AbortSignal
}): Promise<CommandCenterApiPayload> {
  if (!options?.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data
  }

  const data = await retryWithBackoff(
    async () => {
      const res = await apiFetch(`${API_BASE}/api/dashboard/command-center`, {
        headers: { Accept: "application/json" },
        signal: options?.signal,
      })
      const json = await readJsonSafe<Envelope>(res)
      if (!res.ok) throw extractApiError(res.status, "Failed to load Command Center", json)
      if (!json?.success || !json.data) throw new Error(json?.error || "Failed to load Command Center")
      return json.data
    },
    {
      minDurationMs: DASHBOARD_FETCH_RETRY.minDurationMs,
      initialDelayMs: DASHBOARD_FETCH_RETRY.initialDelayMs,
      maxDelayMs: DASHBOARD_FETCH_RETRY.maxDelayMs,
      backoffFactor: DASHBOARD_FETCH_RETRY.backoffFactor,
      signal: options?.signal,
      onRetry: (attempt, delayMs, error) => {
        logSafeWarn(`[command-center] fetch retry #${attempt} in ${delayMs}ms`, error)
      },
    },
  )

  cached = { at: Date.now(), data }
  return data
}
