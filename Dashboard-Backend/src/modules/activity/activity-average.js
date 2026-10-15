/**
 * Activity is one figure across the dashboard: the plain average of the activity levels
 * of the screenshots in question, as a manager may have corrected them. The Screenshots
 * page shows those levels, Apps and URLs average the ones taken on each app and site,
 * and Time & Activity and Work Sessions average the ones taken in each session - so a
 * correction on a screenshot moves every one of them.
 *
 * Totals travel as a sum and a count rather than a percentage, so rows can be added up
 * (days into weeks, members into a project) and still average correctly.
 */

/** The average of `sum` over `count` levels, or null when there were no screenshots. */
export function averageActivity(sum, count) {
  return count > 0 ? Math.round(sum / count) : null;
}

/** A site's domain as screenshots and URL logs both write it: lowercase, without "www.". */
export function activityDomainKey(domain) {
  return String(domain ?? "").trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Totals screenshot levels under a key. `keyOf` returns the key for a row, or "" to
 * leave the row out.
 */
export function totalActivityBy(rows, keyOf) {
  const totals = new Map();
  for (const row of rows) {
    const level = Number(row.activity_level);
    if (!Number.isFinite(level)) continue;
    const key = keyOf(row);
    if (!key) continue;
    const total = totals.get(key) ?? { sum: 0, count: 0 };
    total.sum += level;
    total.count += 1;
    totals.set(key, total);
  }
  return totals;
}

/** The average under `key` in totals from totalActivityBy, or null when none. */
export function activityFor(totals, key) {
  const total = totals.get(key);
  return total ? averageActivity(total.sum, total.count) : null;
}
