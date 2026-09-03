
export const BACKEND_CONNECTION_LOST = "vt-backend-connection-lost"
export const BACKEND_CONNECTION_RESTORED = "vt-backend-connection-restored"

export const BACKEND_UNAVAILABLE_TITLE = "Service unavailable"

export const BACKEND_UNAVAILABLE_MESSAGE =
  "We're having trouble connecting you right now. Please try again in a moment."

export const BACKEND_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Our service is temporarily unavailable. Please try again shortly."

export const BACKEND_UNAVAILABLE_TIMEOUT_MESSAGE =
  "This is taking longer than expected. Please try again."

export const BACKEND_RECONNECTING_TITLE = "Reconnecting…"

export const BACKEND_RECONNECTING_HINT =
  "Your workspace stays open. We'll restore your connection automatically."

export const BACKEND_CONNECTING_MESSAGE = "Connecting…"

export const BACKEND_RETRY_LABEL = "Try again"

export const BACKEND_RETURN_HOME_LABEL = "Return to home"

export const SERVICE_REQUEST_FAILED_MESSAGE =
  "We couldn't complete that request. Please try again."

export function serviceReconnectAttemptMessage(attempt: number): string {
  return `Reconnecting… (attempt ${attempt})`
}

export function serviceConnectingAttemptMessage(attempt: number): string {
  return `Connecting… (attempt ${attempt})`
}

const DEFAULT_LOST_MESSAGE = BACKEND_UNAVAILABLE_MESSAGE

let connectionLostActive = false
let consecutiveFailureCount = 0
const CONSECUTIVE_FAILURES_BEFORE_LOST = 4

export function isApiConnectionFailureStatus(status: number): boolean {
  if (status === 0) return true
  return status === 502 || status === 503 || status === 504
}

export function isApiConnectionNetworkError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false
  if (error instanceof Error && error.message.startsWith("Not authenticated")) return false
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /failed to fetch|networkerror|econnrefused|enotfound|etimedout|socket hang up/i.test(
    message,
  )
}

export function notifyBackendConnectionLost(message = DEFAULT_LOST_MESSAGE): void {
  if (typeof window === "undefined") return
  consecutiveFailureCount += 1
  if (connectionLostActive) return
  if (consecutiveFailureCount < CONSECUTIVE_FAILURES_BEFORE_LOST) return
  connectionLostActive = true
  window.dispatchEvent(new CustomEvent(BACKEND_CONNECTION_LOST, { detail: { message } }))
}

export function notifyBackendConnectionRestored(): void {
  if (typeof window === "undefined") return
  consecutiveFailureCount = 0
  if (!connectionLostActive) return
  connectionLostActive = false
  window.dispatchEvent(new Event(BACKEND_CONNECTION_RESTORED))
}

export function isBackendConnectionLost(): boolean {
  return connectionLostActive
}

const DEFAULT_RATE_LIMIT_BACKOFF_MS = 20_000

let rateLimitedUntil = 0

export function notifyBackendRateLimited(retryAfterMs?: number): void {
  const cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : DEFAULT_RATE_LIMIT_BACKOFF_MS
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + cooldown)
}

export function isBackendRateLimited(): boolean {
  return Date.now() < rateLimitedUntil
}
