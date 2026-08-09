import { isManagementRole } from "../../http/auth-context.js";
import {
  getAllCategoriesPg,
  getCategoryPg,
  upsertCategoryPg,
  deleteCategoryPg,
} from "../../lib/postgres/classification-postgres.service.js";
import {
  findUnclassifiedAppsPg,
  findUnclassifiedDomainsPg,
} from "../../lib/postgres/activity-events-postgres.service.js";

export const CATEGORIES = Object.freeze(["productive", "neutral", "distracting", "unclassified"]);
export const MATCH_TYPES = Object.freeze(["app", "domain"]);

function normalizeRow(row) {
  return {
    id: row.id,
    matchType: row.match_type,
    pattern: row.pattern,
    category: row.category,
    displayName: row.display_name ?? null,
    roleOverride: row.role_override ?? {},
    isGlobalDefault: row.is_global_default === true,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** CLS-1: the full classification map - what a settings UI lists, and what MAC-3/CQ-4's display-name consumers read. */
export async function getAllCategories() {
  const rows = await getAllCategoriesPg();
  return rows.map(normalizeRow);
}

/**
 * CLS-1: the only write path for activity_categories - admin-gated, same
 * shape as CF-1's setMonitoringCapability. Unlike CF-1, there's no audit
 * trail requirement here (this isn't a legal-compliance-evidence table, it's
 * a productivity-labelling one), so no paired audit insert.
 * @param {{ matchType: string, pattern: string, category?: string, displayName?: string|null, roleOverride?: object }} input
 * @param {{ memberId: string, roleName: string }} actor
 */
export async function setCategory(input, actor) {
  if (!MATCH_TYPES.includes(input.matchType)) {
    const err = new Error(`matchType must be 'app' or 'domain', got '${input.matchType}'`);
    err.code = "INVALID_MATCH_TYPE";
    throw err;
  }
  const pattern = String(input.pattern ?? "").trim();
  if (!pattern) {
    const err = new Error("pattern is required");
    err.code = "PATTERN_REQUIRED";
    throw err;
  }
  if (input.category !== undefined && !CATEGORIES.includes(input.category)) {
    const err = new Error(`Unknown category: ${input.category}`);
    err.code = "UNKNOWN_CATEGORY";
    throw err;
  }
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change app/domain classification.");
    err.code = "FORBIDDEN";
    throw err;
  }
  const row = await upsertCategoryPg({
    matchType: input.matchType,
    pattern,
    category: input.category,
    displayName: input.displayName,
    roleOverride: input.roleOverride,
    createdBy: actor.memberId,
  });
  return row ? normalizeRow(row) : null;
}

/** @param {string} id @param {{ memberId: string, roleName: string }} actor */
export async function removeCategory(id, actor) {
  if (!isManagementRole(actor?.roleName)) {
    const err = new Error("Only management may change app/domain classification.");
    err.code = "FORBIDDEN";
    throw err;
  }
  await deleteCategoryPg(id);
}

/**
 * CLS-1/C1: resolves the effective category for an app or domain, applying
 * a role override when the viewer's role has one - "a designer on Behance is
 * productive, a data-entry clerk on Behance is distracting" without
 * hardcoding that judgement into application code. Falls back to
 * 'unclassified' for anything with no row at all (CLS-3's review-queue
 * territory, not this function's job to guess at).
 * @param {'app'|'domain'} matchType @param {string} name @param {string} [roleName]
 */
export async function categorize(matchType, name, roleName) {
  if (!name) return "unclassified";
  const row = await getCategoryPg(matchType, name);
  if (!row) return "unclassified";
  const normalized = normalizeRow(row);
  if (roleName) {
    const key = String(roleName).trim().toLowerCase();
    const override = normalized.roleOverride?.[key];
    if (override && CATEGORIES.includes(override)) return override;
  }
  return normalized.category;
}

/**
 * CLS-3: "surface a manager review queue" - frequently-used apps/domains
 * with no real classification yet, ranked by actual usage. Deliberately not
 * an ML classifier - "a curated list plus manager overrides beats it in
 * accuracy and trust, and doesn't leak your customers' browsing to a third-
 * party model" (Part C.3). A human decides; this just surfaces what's worth
 * deciding on.
 * @param {number} [sinceDays] @param {number} [limit]
 */
export async function getUnclassifiedReviewQueue(sinceDays, limit) {
  const [apps, domains] = await Promise.all([
    findUnclassifiedAppsPg(sinceDays, limit),
    findUnclassifiedDomainsPg(sinceDays, limit),
  ]);
  return {
    apps: apps.map((r) => ({ pattern: r.app_name, totalSeconds: Number(r.total_seconds), logCount: r.log_count })),
    domains: domains.map((r) => ({ pattern: r.domain, totalSeconds: Number(r.total_seconds), logCount: r.log_count })),
  };
}

/**
 * CQ-4/MAC-3: the display-name lookup both Rust (window.rs) and the
 * frontend (display-names.ts) should eventually read from instead of their
 * own independent, already-drifted hardcoded maps. Falls back to null
 * (caller applies its own generic ".exe"-stripping fallback) rather than
 * inventing a name for a pattern with no explicit mapping.
 * @param {string} appName
 */
export async function getAppDisplayName(appName) {
  if (!appName) return null;
  const row = await getCategoryPg("app", appName);
  return row?.display_name ?? null;
}
