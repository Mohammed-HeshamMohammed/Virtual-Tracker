import { normalizeRoleKey } from "../members/services/relation-sync.js";
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

export function canClassifyActivity(roleName) {
  const key = normalizeRoleKey(roleName);
  return key === "owner" || key === "superadmin" || key === "admin";
}

export const CLASSIFY_DENIED_MESSAGE =
  "Only Owner, Super Admin, or Admin can classify apps and URLs.";

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

// Every /api/activity/feed request rebuilt the classification lookup from a
// full table scan, for a table that changes a handful of times a month. That
// was a bigger per-request cost than the URL-index join added alongside it.
// Same 15s TTL + explicit invalidation shape as lib/postgres/lookup-cache.js.
const CATEGORY_CACHE_TTL_MS = 15 * 1000;
let categoryCache = { rows: null, expiresAt: 0 };

export function invalidateCategoryCache() {
  categoryCache = { rows: null, expiresAt: 0 };
}

export async function getAllCategories() {
  if (categoryCache.rows && Date.now() < categoryCache.expiresAt) {
    return categoryCache.rows;
  }
  const rows = (await getAllCategoriesPg()).map(normalizeRow);
  categoryCache = { rows, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS };
  return rows;
}

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
  if (!canClassifyActivity(actor?.roleName)) {
    const err = new Error(CLASSIFY_DENIED_MESSAGE);
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
  // Without this a just-saved classification would take up to the TTL to show
  // in the feeds - indistinguishable from the bug this whole change fixes.
  invalidateCategoryCache();
  return row ? normalizeRow(row) : null;
}

export async function removeCategory(id, actor) {
  if (!canClassifyActivity(actor?.roleName)) {
    const err = new Error(CLASSIFY_DENIED_MESSAGE);
    err.code = "FORBIDDEN";
    throw err;
  }
  await deleteCategoryPg(id);
  invalidateCategoryCache();
}

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

export async function getAppDisplayName(appName) {
  if (!appName) return null;
  const row = await getCategoryPg("app", appName);
  return row?.display_name ?? null;
}
