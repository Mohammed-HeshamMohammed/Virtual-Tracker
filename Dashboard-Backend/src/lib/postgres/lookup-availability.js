import { logSafeWarn } from "../../http/sanitize-error.js";
import { isPostgresConfigured, query } from "./client.js";

/** @type {boolean | undefined} */
let lookupReady;

/** Cached check: POSTGRES_URL + roles table reachable. Falls back to Firestore otherwise. */
export async function isPostgresLookupReady() {
  if (!isPostgresConfigured()) return false;
  if (lookupReady === true) return true;
  await query("SELECT 1 FROM roles LIMIT 1");
  lookupReady = true;
  return true;
}

/** @internal */
export function markPostgresLookupReady() {
  lookupReady = true;
}

/** @internal */
export function resetPostgresLookupReadyCache() {
  lookupReady = undefined;
}
