import { isPostgresConfigured, query } from "./client.js";

/** @type {boolean | undefined} */
let memberDataReady;

/** Cached check: POSTGRES_URL set and limits table reachable. */
export async function isPostgresMemberDataReady() {
  if (!isPostgresConfigured()) return false;
  if (memberDataReady === true) return true;
  try {
    await query("SELECT 1 FROM limits LIMIT 1");
    memberDataReady = true;
    return true;
  } catch {
    return false;
  }
}

/** @internal */
export function markPostgresMemberDataReady() {
  memberDataReady = true;
}

/** @internal */
export function resetPostgresMemberDataReadyCache() {
  memberDataReady = undefined;
}
