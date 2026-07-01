/** Shared retry helper for transient backend failures (5xx, network, unavailable). */

import { isFirestoreQuotaExceededError } from "@/features/auth/services/firestore-quota"
import {
  isInfrastructureError,
  isServiceUnavailableError,
} from "@/features/auth/services/service-unavailable"

export class RetriableBackendError extends Error {
  readonly statusHint?: number

  constructor(message: string, statusHint?: number) {
    super(message)
    this.name = "RetriableBackendError"
    this.statusHint = statusHint
  }
}

export type RetryWithBackoffOptions = {
  /** Keep retrying until this duration elapses (default 60s). */
  minDurationMs?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
  /** Return false to stop retrying immediately. */
  isRetriable?: (error: unknown) => boolean
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  signal?: AbortSignal
}

const DEFAULT_MIN_DURATION_MS = 60_000
const DEFAULT_INITIAL_DELAY_MS = 750
const DEFAULT_MAX_DELAY_MS = 8_000
const DEFAULT_BACKOFF_FACTOR = 1.8

export function isRetriableBackendError(error: unknown): boolean {
  if (isFirestoreQuotaExceededError(error)) return false
  if (isServiceUnavailableError(error)) return true
  if (isInfrastructureError(error)) return false
  if (error instanceof RetriableBackendError) return true
  const msg = error instanceof Error ? error.message : String(error ?? "")
  const lower = msg.toLowerCase()

  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("networkerror")) {
    return true
  }

  const httpMatch = /\bhttp\s*(\d{3})\b/i.exec(msg) || /\b(\d{3})\b/.exec(msg)
  if (httpMatch) {
    const code = Number.parseInt(httpMatch[1], 10)
    if (code === 401 || code === 403 || code === 404 || code === 422) return false
    if (code >= 500 || code === 408 || code === 429 || code === 503) return true
  }

  if (
    lower.includes("service unavailable") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("econnrefused") ||
    lower.includes("timeout")
  ) {
    return true
  }

  return false
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const minDurationMs = options.minDurationMs ?? DEFAULT_MIN_DURATION_MS
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR
  const isRetriable = options.isRetriable ?? isRetriableBackendError

  const startedAt = Date.now()
  let attempt = 0
  let delayMs = initialDelayMs
  let lastError: unknown

  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError")
    }

    try {
      return await fn()
    } catch (error) {
      lastError = error
      const elapsed = Date.now() - startedAt
      if (!isRetriable(error) || elapsed >= minDurationMs) {
        throw error
      }

      attempt += 1
      options.onRetry?.(attempt, delayMs, error)
      console.warn(`[retryWithBackoff] attempt ${attempt} failed; retrying in ${delayMs}ms`, error)

      await sleep(delayMs, options.signal)
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * backoffFactor))
    }
  }
}
