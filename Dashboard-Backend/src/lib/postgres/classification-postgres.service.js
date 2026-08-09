import { query } from "./client.js";

const COLUMNS =
  "id, match_type, pattern, category, display_name, role_override, is_global_default, created_by, created_at, updated_at";

export async function getAllCategoriesPg() {
  return query(`SELECT ${COLUMNS} FROM activity_categories ORDER BY match_type, pattern`);
}

/** @param {string} matchType @param {string} pattern */
export async function getCategoryPg(matchType, pattern) {
  const rows = await query(
    `SELECT ${COLUMNS} FROM activity_categories WHERE match_type = $1 AND lower(pattern) = lower($2) LIMIT 1`,
    [matchType, pattern],
  );
  return rows[0] ?? null;
}

/**
 * Upsert by (match_type, pattern) - a single authoritative row per pattern,
 * matching CF-1/CF-3's precedent (no layered org-override lookup, since no
 * org concept exists in this schema). An admin edit always sets
 * is_global_default = false, marking the row as customized regardless of
 * whether it started as a shipped seed - "still using the shipped default"
 * vs "an admin touched this" is exactly what that flag now means.
 * @param {{ matchType: string, pattern: string, category?: string, displayName?: string|null, roleOverride?: object, createdBy?: string }} input
 */
export async function upsertCategoryPg(input) {
  const rows = await query(
    `INSERT INTO activity_categories (match_type, pattern, category, display_name, role_override, is_global_default, created_by)
     VALUES ($1, $2, COALESCE($3, 'unclassified'), $4, COALESCE($5, '{}'::jsonb), false, $6)
     ON CONFLICT (match_type, lower(pattern)) DO UPDATE SET
       category = COALESCE($3, activity_categories.category),
       display_name = COALESCE($4, activity_categories.display_name),
       role_override = COALESCE($5, activity_categories.role_override),
       is_global_default = false,
       updated_at = now()
     RETURNING ${COLUMNS}`,
    [
      input.matchType,
      input.pattern,
      input.category ?? null,
      input.displayName ?? null,
      input.roleOverride ? JSON.stringify(input.roleOverride) : null,
      input.createdBy ?? null,
    ],
  );
  return rows[0] ?? null;
}

/** @param {string} id */
export async function deleteCategoryPg(id) {
  await query(`DELETE FROM activity_categories WHERE id = $1`, [id]);
}
