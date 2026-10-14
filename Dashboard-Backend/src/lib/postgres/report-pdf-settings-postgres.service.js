import { query } from "./client.js";

/** The member's saved PDF look, or null if they never saved one. */
export async function getReportPdfSettingsPg(memberId) {
  const rows = await query("SELECT options FROM report_pdf_settings WHERE member_id = $1", [memberId]);
  return rows[0]?.options ?? null;
}

export async function saveReportPdfSettingsPg(memberId, options) {
  const rows = await query(
    `INSERT INTO report_pdf_settings (member_id, options)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (member_id) DO UPDATE SET options = EXCLUDED.options, updated_at = now()
     RETURNING options`,
    [memberId, JSON.stringify(options)],
  );
  return rows[0].options;
}
