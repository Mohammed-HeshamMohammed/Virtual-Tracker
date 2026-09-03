import { isPostgresConfigured, query } from "./client.js";

let memberDataReady;

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

export function markPostgresMemberDataReady() {
  memberDataReady = true;
}

export function resetPostgresMemberDataReadyCache() {
  memberDataReady = undefined;
}
