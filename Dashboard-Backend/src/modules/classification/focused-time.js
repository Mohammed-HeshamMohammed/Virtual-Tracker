import { getDb } from "../../config/firebase.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getAllCategories } from "./activity-categories.js";
import { buildCategoryLookup, buildUrlIndex, resolveActivityCategory } from "../activity/category-resolver.js";
import {
  fetchAppLogRowsForRangePg,
  fetchUrlLogRowsForRangePg,
} from "../../lib/postgres/activity-events-postgres.service.js";

/**
 * Focused time is now resolved through `category-resolver.js`, the same module
 * the Screenshots, Apps and URLs feeds use. It used to be a fourth, private
 * copy of the classification rules, and it was wrong in two ways because of
 * it.
 *
 * 1. It double-counted browsing. It summed `activity_app_logs` (which
 *    includes "Google Chrome") *and* `activity_url_logs`, but the agent emits
 *    an app slice and a URL slice for the *same* seconds - so every browsing
 *    second landed in the total twice, once as an unclassifiable browser and
 *    once as its domain. A member who browsed all day reported roughly double
 *    their tracked time.
 *
 * 2. It ignored `window_title` classifications. Its category maps were built
 *    from `matchType === "app"` and `"domain"` only, so labelling a page the
 *    agent could only read as a window title changed the Activity tab and
 *    nothing else.
 *
 * The fix for both is the same: seconds come from `activity_app_logs` alone -
 * that is the authoritative record of what was in the foreground - and URL
 * logs are consulted purely as an index of which site was open at a given
 * moment. Nothing is summed twice, and every match type the resolver knows
 * about is honoured, because there is only one implementation of the rules
 * left.
 */

/** Rows to pull before giving up on precision. A month of 15s slices for one
 *  member is roughly 40k; beyond this the range is unreasonable for a summary
 *  and the caller should narrow it. */
const MAX_ROWS = 50_000;

/**
 * The whole computation, with no database in it, so the rules above can be
 * tested directly rather than inferred from a mocked query layer.
 */
export function summarizeFocusedTime({ appRows, urlRows, categories, roleName }) {
  const lookup = buildCategoryLookup(categories, roleName);
  const urlIndex = buildUrlIndex(urlRows);

  const totals = { productive: 0, neutral: 0, distracting: 0, unclassified: 0 };
  const byPattern = new Map();

  for (const row of appRows) {
    const appName = String(row.app_name ?? "");
    const seconds = Math.max(0, Number(row.duration_seconds) || 0);
    if (seconds === 0) continue;

    const resolved = resolveActivityCategory(lookup, {
      appName,
      pageTitle: row.page_title || "",
      at: row.started_at,
      sessionId: row.session_id,
      urlIndex,
    });

    const category = resolved.category ?? "unclassified";
    totals[category] = (totals[category] ?? 0) + seconds;

    // Report browsing under the site it resolved to, everything else under
    // the app - the same thing the Activity tab shows for these seconds.
    const pattern = resolved.domain || appName;
    const matchType = resolved.source === "app" ? "app" : "domain";
    const key = `${matchType}:${pattern.toLowerCase()}`;
    const existing = byPattern.get(key);
    if (existing) {
      existing.seconds += seconds;
    } else {
      byPattern.set(key, { pattern, matchType, category, seconds });
    }
  }

  const totalSeconds =
    totals.productive + totals.neutral + totals.distracting + totals.unclassified;

  return {
    totalSeconds,
    productiveSeconds: totals.productive,
    neutralSeconds: totals.neutral,
    distractingSeconds: totals.distracting,
    unclassifiedSeconds: totals.unclassified,
    breakdown: [...byPattern.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

export async function getFocusedTimeSummary(memberId, range) {
  const db = getDb();
  const [categories, roleName, appRows, urlRows] = await Promise.all([
    getAllCategories(),
    db ? resolveMemberRoleName(db, memberId) : Promise.resolve(""),
    fetchAppLogRowsForRangePg(memberId, range, MAX_ROWS),
    fetchUrlLogRowsForRangePg(memberId, range, MAX_ROWS),
  ]);
  return {
    memberId,
    fromDay: range.fromDay,
    toDay: range.toDay,
    ...summarizeFocusedTime({ appRows, urlRows, categories, roleName }),
  };
}
