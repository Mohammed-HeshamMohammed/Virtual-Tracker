import { query } from "./client.js";

export async function getCaptureExclusionsPg() {
  return query(
    `SELECT id, match_type, pattern, note, created_by, created_at FROM capture_exclusions ORDER BY created_at DESC`,
  );
}

/** @param {{ matchType: 'app'|'domain', pattern: string, note?: string, createdBy?: string }} input */
export async function addCaptureExclusionPg(input) {
  const rows = await query(
    `INSERT INTO capture_exclusions (match_type, pattern, note, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (match_type, lower(pattern)) DO NOTHING
     RETURNING id, match_type, pattern, note, created_by, created_at`,
    [input.matchType, input.pattern, input.note ?? null, input.createdBy ?? null],
  );
  return rows[0] ?? null;
}

/** @param {string} id */
export async function removeCaptureExclusionPg(id) {
  await query(`DELETE FROM capture_exclusions WHERE id = $1`, [id]);
}

export async function getCaptureMinimizationSettingsPg() {
  const rows = await query(
    `SELECT url_domain_only, screenshot_blur_default, updated_by, updated_at
     FROM capture_minimization_settings WHERE id = 1 LIMIT 1`,
  );
  return rows[0] ?? { url_domain_only: false, screenshot_blur_default: false };
}

/** @param {{ urlDomainOnly?: boolean, screenshotBlurDefault?: boolean, updatedBy?: string }} input */
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
