import { logSafeWarn } from "../../http/sanitize-error.js";
import { isPostgresConfigured, query } from "./client.js";

/** @type {boolean | undefined} */
let lookupReady;

/**
 * True when POSTGRES_URL is set and lookup tables (roles) are reachable.
 * Falls back to Firestore when tables are missing, still seeding, or unreachable.
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
    logSafeWarn("[postgres] lookup probe failed; using Firestore fallback:", err);
    lookupReady = false;
    return false;
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
