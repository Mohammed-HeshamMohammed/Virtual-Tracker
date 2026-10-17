import { subscribeChanges } from "../realtime/change-bus.js";

const DEFAULT_TTL_MS = 60_000;
const cache = new Map();

subscribeChanges((message) => {
  if (["projects", "clients", "project-members", "members", "roles"].includes(message.resource)) {
    clearDashboardCache();
  }
});

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
