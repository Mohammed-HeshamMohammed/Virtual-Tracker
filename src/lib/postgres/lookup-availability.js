import { isPostgresConfigured, query } from "./client.js";

/** @type {boolean | undefined} */
let lookupReady;

/**
 * True when POSTGRES_URL is set and lookup tables (roles) are reachable.
 * Falls back to Firestore when tables are missing or not migrated yet.
 */
export async function isPostgresLookupReady() {
  if (!isPostgresConfigured()) return false;
  if (lookupReady === true) return true;
  if (lookupReady === false) return false;
  try {
    await query("SELECT 1 FROM roles LIMIT 1");
    lookupReady = true;
    return true;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "42P01") {
      lookupReady = false;
      return false;
    }
    throw err;
  }
}

/** @internal */
export function markPostgresLookupReady() {
  lookupReady = true;
}

/** @internal */
export function resetPostgresLookupReadyCache() {
  lookupReady = undefined;
}
