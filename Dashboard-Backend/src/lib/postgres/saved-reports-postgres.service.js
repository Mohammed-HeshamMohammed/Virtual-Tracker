// Reports a member pinned to the hub's "Customized reports" strip.

import { query } from "./client.js";

/**
 * @param {string} memberId
 * @returns {Promise<{ id: string, pageId: string, title: string, tag: string }[]>}
 */
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

/**
 * Pinning a report already pinned is a no-op rather than an error - the button
 * is a toggle and a double click should not 500.
 * @param {{ memberId: string, pageId: string, title: string, tag?: string }} input
 */
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

/**
 * Scoped to the owner: a member can only unpin their own row, so the id alone
 * is never enough to delete someone else's.
 * @param {string} memberId
 * @param {string} savedReportId
 */
export async function deleteSavedReportPg(memberId, savedReportId) {
  const rows = await query("DELETE FROM saved_reports WHERE id = $1 AND member_id = $2 RETURNING id", [
    savedReportId,
    memberId,
  ]);
  return rows.length > 0;
}
