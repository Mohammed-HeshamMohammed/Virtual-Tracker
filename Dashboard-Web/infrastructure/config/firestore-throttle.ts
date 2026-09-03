
const isDev = process.env.NODE_ENV === "development"

export const LIST_REFETCH_INTERVAL_MS = isDev ? 300_000 : 50_000

export const ACTIVITY_SESSION_SYNC_MS = isDev ? 180_000 : 120_000

export const BOOTSTRAP_WARM_TTL_MS = isDev ? 15 * 60_000 : 5 * 60_000

export const ACTIVITY_FEED_POLL_MS = isDev ? 60_000 : 120_000
export const ACTIVITY_FEED_PING_DEBOUNCE_MS = isDev ? 8_000 : 12_000

export const ACTIVITY_FEED_DASHBOARD_CACHE_MS = isDev ? 10 * 60_000 : 3 * 60_000
