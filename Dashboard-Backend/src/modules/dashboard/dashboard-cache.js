/** Short-lived in-process cache for expensive dashboard aggregations. */

const DEFAULT_TTL_MS = 60_000;
/** @type {Map<string, { data: unknown, expiresAt: number }>} */
const cache = new Map();

/**
 * @param {string} key
 * @returns {unknown | null}
 */
export function getDashboardCache(key) {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

/**
 * @param {string} key
 * @param {unknown} data
 * @param {number} [ttlMs]
 */
export function setDashboardCache(key, data, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** @param {string} key */
export function invalidateDashboardCache(key) {
  cache.delete(key);
}

export function clearDashboardCache() {
  cache.clear();
}
