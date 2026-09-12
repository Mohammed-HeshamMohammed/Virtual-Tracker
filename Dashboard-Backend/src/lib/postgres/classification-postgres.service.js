import { query } from "./client.js";

// A classification rule is the content it matches and what that content
// counts as - nothing about who entered it or where it came from. `created_by`
// is deliberately not selected or written: it was the one column in here that
// was neither, nothing ever read it, and it left a bare member id behind in a
// table that outlives every project and member it was learned from.
const COLUMNS =
  "id, match_type, pattern, category, display_name, role_override, is_global_default, created_at, updated_at";

export async function getAllCategoriesPg() {
  return query(`SELECT ${COLUMNS} FROM activity_categories ORDER BY match_type, pattern`);
}

export async function getCategoryPg(matchType, pattern) {
  const rows = await query(
    `SELECT ${COLUMNS} FROM activity_categories WHERE match_type = $1 AND lower(pattern) = lower($2) LIMIT 1`,
    [matchType, pattern],
  );
  return rows[0] ?? null;
}

export async function upsertCategoryPg(input) {
  const rows = await query(
    `INSERT INTO activity_categories (match_type, pattern, category, display_name, role_override, is_global_default)
     VALUES ($1, $2, COALESCE($3, 'unclassified'), $4, COALESCE($5, '{}'::jsonb), false)
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
    ],
  );
  return rows[0] ?? null;
}

export async function deleteCategoryPg(id) {
  await query(`DELETE FROM activity_categories WHERE id = $1`, [id]);
}
