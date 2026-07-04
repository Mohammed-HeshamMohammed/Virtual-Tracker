import { isPostgresConfigured, query } from "./client.js";

/** @type {boolean | undefined} */
let memberDataReady;

/**
 * True when POSTGRES_URL is set and member-domain tables are reachable.
 * Member profile extensions (limits, employment, bans, …) have no Firestore fallback.
 */
export async function isPostgresMemberDataReady() {
  if (!isPostgresConfigured()) return false;
  if (memberDataReady === true) return true;
  await query("SELECT 1 FROM limits LIMIT 1");
  memberDataReady = true;
  return true;
}

/** @internal */
export function markPostgresMemberDataReady() {
  memberDataReady = true;
}

/** @internal */
export function resetPostgresMemberDataReadyCache() {
  memberDataReady = undefined;
}
