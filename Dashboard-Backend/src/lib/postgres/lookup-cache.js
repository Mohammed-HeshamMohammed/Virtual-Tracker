import { query } from "./client.js";
import { subscribeChanges } from "../../modules/realtime/change-bus.js";

const CACHE_TTL_MS = 15 * 1000;
/** @type {{ data: { roles: Record<string, unknown>[]; lookups: Record<string, unknown>[]; orgOptions: Record<string, unknown>[] } | null; expiresAt: number }} */
let cache = { data: null, expiresAt: 0 };

subscribeChanges((msg) => {
  if (msg.resource === "roles" || msg.resource === "lookups" || msg.resource === "orgOptions") {
    invalidateLookupCache();
  }
});

/**
 * @returns {Promise<{ roles: Record<string, unknown>[]; lookups: Record<string, unknown>[]; orgOptions: Record<string, unknown>[] }>}
 */
export async function getLookupData() {
  if (cache.data && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  try {
    const [roles, lookups, orgOptions] = await Promise.all([
      query("SELECT id, name, description, created_at, created_by, updated_by, updated_at FROM roles ORDER BY name"),
      query("SELECT category, id, name, list_ranking, created_at, created_by, updated_by, updated_at FROM lookup_tables ORDER BY category, list_ranking, name"),
      query("SELECT type, id, label, position, created_at, updated_at, modified_by FROM org_field_options ORDER BY type, position"),
    ]);

    cache = {
      data: { roles, lookups, orgOptions },
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return cache.data;
  } catch (err) {
    if (cache.data) return cache.data;
    return { roles: [], lookups: [], orgOptions: [] };
  }
}

/** Call after admin writes to roles, lookups, or org field options. */
export function invalidateLookupCache() {
  cache = { data: null, expiresAt: 0 };
}

