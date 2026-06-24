/** Auth/session sync retry policy — fail fast with user-visible retry instead of 60s trap. */

export const AUTH_SYNC_RETRY = {
  minDurationMs: 12_000,
  initialDelayMs: 600,
  maxDelayMs: 4_000,
  backoffFactor: 1.8,
} as const

export const FIREBASE_INIT_RETRY = {
  minDurationMs: 15_000,
  initialDelayMs: 750,
  maxDelayMs: 4_000,
  backoffFactor: 1.8,
} as const

export const DASHBOARD_FETCH_RETRY = {
  minDurationMs: 15_000,
  initialDelayMs: 600,
  maxDelayMs: 4_000,
  backoffFactor: 1.8,
} as const
