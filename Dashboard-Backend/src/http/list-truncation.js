import { logSafeWarn } from "./sanitize-error.js";

/**
 * Every large list in this API is capped (500 members, 500 projects, 2000
 * invoices) and returned as a plain array, so an organization past the cap saw
 * a truncated list with nothing to say so - it presents as "a member is missing
 * from the dashboard" rather than as an error.
 *
 * The count only runs when the page came back full, so the normal case costs
 * nothing.
 */
export async function listMeta(rows, limit, countTotal) {
  if (!Array.isArray(rows) || rows.length < limit) {
    return { truncated: false, returned: rows?.length ?? 0, total: rows?.length ?? 0, limit };
  }
  let total = rows.length;
  try {
    const counted = Number(await countTotal());
    if (Number.isFinite(counted) && counted > total) total = counted;
  } catch (err) {
    // A failed count must not fail the list; the page is still correct, it
    // just cannot say how much is beyond it.
    logSafeWarn("[list-truncation] could not count the full set", err);
  }
  return { truncated: total > rows.length, returned: rows.length, total, limit };
}
