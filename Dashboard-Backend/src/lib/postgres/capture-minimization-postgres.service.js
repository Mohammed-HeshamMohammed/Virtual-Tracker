import { query } from "./client.js";

/** `memberId` null lists the org-wide rows only; a member id lists theirs too. */
export async function getCaptureExclusionsPg(memberId = null) {
  return query(
    `SELECT id, match_type, pattern, note, created_by, created_at, member_id
       FROM capture_exclusions
      WHERE member_id IS NULL OR member_id = $1
      ORDER BY created_at DESC`,
    [memberId],
  );
}

export async function addCaptureExclusionPg(input) {
  const memberId = input.memberId ?? null;
  // Two partial unique indexes, so the conflict target has to carry the same
  // predicate - a bare ON CONFLICT (match_type, lower(pattern)) matches
  // neither of them and errors instead of doing nothing.
  const conflict = memberId
    ? "(member_id, match_type, lower(pattern)) WHERE member_id IS NOT NULL"
    : "(match_type, lower(pattern)) WHERE member_id IS NULL";
  const rows = await query(
    `INSERT INTO capture_exclusions (match_type, pattern, note, created_by, member_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ${conflict} DO NOTHING
     RETURNING id, match_type, pattern, note, created_by, created_at, member_id`,
    [input.matchType, input.pattern, input.note ?? null, input.createdBy ?? null, memberId],
  );
  return rows[0] ?? null;
}

/**
 * `memberId` scopes the delete to that member's own rows; null scopes it to the
 * org-wide ones. Deleting by id alone would let the org route remove a
 * member's personal exclusion, which is theirs to keep, and the member route
 * remove an org rule. Returns whether a row was actually removed.
 */
export async function removeCaptureExclusionPg(id, memberId = null) {
  const rows = await query(
    `DELETE FROM capture_exclusions WHERE id = $1 AND member_id IS NOT DISTINCT FROM $2::uuid RETURNING id`,
    [id, memberId],
  );
  return rows.length > 0;
}

export async function getOwnCaptureExclusionsPg(memberId) {
  return query(
    `SELECT id, match_type, pattern, note, created_by, created_at, member_id
       FROM capture_exclusions WHERE member_id = $1 ORDER BY created_at DESC`,
    [memberId],
  );
}

export async function countOwnCaptureExclusionsPg(memberId) {
  const rows = await query(`SELECT count(*)::int AS n FROM capture_exclusions WHERE member_id = $1`, [memberId]);
  return rows[0]?.n ?? 0;
}

export async function getCaptureMinimizationSettingsPg() {
  const rows = await query(
    `SELECT url_domain_only, screenshot_blur_default, updated_by, updated_at
     FROM capture_minimization_settings WHERE id = 1 LIMIT 1`,
  );
  return rows[0] ?? { url_domain_only: false, screenshot_blur_default: false };
}

export async function setCaptureMinimizationSettingsPg(input) {
  const rows = await query(
    `UPDATE capture_minimization_settings SET
       url_domain_only = COALESCE($1, url_domain_only),
       screenshot_blur_default = COALESCE($2, screenshot_blur_default),
       updated_by = $3,
       updated_at = now()
     WHERE id = 1
     RETURNING url_domain_only, screenshot_blur_default, updated_by, updated_at`,
    [input.urlDomainOnly ?? null, input.screenshotBlurDefault ?? null, input.updatedBy ?? null],
  );
  return rows[0] ?? null;
}
