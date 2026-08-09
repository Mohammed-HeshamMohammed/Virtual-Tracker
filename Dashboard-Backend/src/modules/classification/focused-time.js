import { getDb } from "../../config/firebase.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { getAllCategories } from "./activity-categories.js";
import {
  sumAppLogSecondsByAppNamePg,
  sumUrlLogSecondsByDomainPg,
} from "../../lib/postgres/activity-events-postgres.service.js";

/**
 * CLS-2: "productive/neutral/distracting minutes" instead of, or alongside,
 * the raw activity %. Pure aggregation over activity_app_logs +
 * activity_url_logs joined to CLS-1's classification map - no agent change
 * needed, matches the plan's own framing.
 *
 * Role override is resolved once for the *tracked* member (not the viewer) -
 * "a designer on Behance is productive" is about the person who did the
 * browsing, not whoever is looking at the report.
 *
 * @param {string} memberId @param {{ fromDay: string, toDay: string }} range
 */
export async function getFocusedTimeSummary(memberId, range) {
  const db = getDb();
  const [categories, roleName, appSeconds, domainSeconds] = await Promise.all([
    getAllCategories(),
    db ? resolveMemberRoleName(db, memberId) : Promise.resolve(""),
    sumAppLogSecondsByAppNamePg(memberId, range),
    sumUrlLogSecondsByDomainPg(memberId, range),
  ]);

  const appMap = new Map(
    categories.filter((c) => c.matchType === "app").map((c) => [c.pattern.toLowerCase(), c]),
  );
  const domainMap = new Map(
    categories.filter((c) => c.matchType === "domain").map((c) => [c.pattern.toLowerCase(), c]),
  );
  const roleKey = String(roleName || "").trim().toLowerCase();

  const totals = { productive: 0, neutral: 0, distracting: 0, unclassified: 0 };
  /** @type {{ pattern: string, matchType: string, category: string, seconds: number }[]} */
  const breakdown = [];

  const resolveCategory = (entry) => {
    if (!entry) return "unclassified";
    const override = roleKey ? entry.roleOverride?.[roleKey] : undefined;
    return override ?? entry.category;
  };

  for (const row of appSeconds) {
    const entry = appMap.get(String(row.app_name ?? "").toLowerCase());
    const category = resolveCategory(entry);
    const seconds = Number(row.total_seconds ?? 0);
    totals[category] += seconds;
    breakdown.push({ pattern: row.app_name, matchType: "app", category, seconds });
  }
  for (const row of domainSeconds) {
    const entry = domainMap.get(String(row.domain ?? "").toLowerCase());
    const category = resolveCategory(entry);
    const seconds = Number(row.total_seconds ?? 0);
    totals[category] += seconds;
    breakdown.push({ pattern: row.domain, matchType: "domain", category, seconds });
  }

  const totalSeconds = totals.productive + totals.neutral + totals.distracting + totals.unclassified;
  return {
    memberId,
    fromDay: range.fromDay,
    toDay: range.toDay,
    totalSeconds,
    productiveSeconds: totals.productive,
    neutralSeconds: totals.neutral,
    distractingSeconds: totals.distracting,
    unclassifiedSeconds: totals.unclassified,
    breakdown: breakdown.sort((a, b) => b.seconds - a.seconds),
  };
}
