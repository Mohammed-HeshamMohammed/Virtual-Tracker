
import { query } from "./client.js";

export async function listSavedReportsPg(memberId) {
  const rows = await query(
    `SELECT id, page_id, title, tag
     FROM saved_reports
     WHERE member_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [memberId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    pageId: String(row.page_id),
    title: String(row.title ?? ""),
    tag: String(row.tag ?? ""),
  }));
}

export async function saveReportPg({ memberId, pageId, title, tag = "" }) {
  const rows = await query(
    `INSERT INTO saved_reports (member_id, page_id, title, tag)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (member_id, page_id) DO UPDATE SET title = EXCLUDED.title, tag = EXCLUDED.tag
     RETURNING id, page_id, title, tag`,
    [memberId, pageId, title, tag],
  );
  const row = rows[0];
  return { id: String(row.id), pageId: String(row.page_id), title: String(row.title), tag: String(row.tag ?? "") };
}

export async function deleteSavedReportPg(memberId, savedReportId) {
  const rows = await query("DELETE FROM saved_reports WHERE id = $1 AND member_id = $2 RETURNING id", [
    savedReportId,
    memberId,
  ]);
  return rows.length > 0;
}
