
const DEFAULT_TTL_MS = 60_000;
const cache = new Map();

export function getDashboardCache(key) {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

export function setDashboardCache(key, data, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateDashboardCache(key) {
  cache.delete(key);
}

export function clearDashboardCache() {
  cache.clear();
}
