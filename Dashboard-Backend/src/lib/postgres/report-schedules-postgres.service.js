import { query } from "./client.js";

/**
 * @param {{
 *   reportType?: string, name?: string, memberId?: string | null, emails: string[], subject?: string,
 *   message?: string, fileType: "csv" | "pdf", dateRangeKind: string, frequency: string,
 *   deliveryTime: string, createdBy: string,
 * }} input
 */
export async function insertReportSchedulePg(input) {
  const rows = await query(
    `INSERT INTO report_schedules
       (report_type, name, member_id, emails, subject, message, file_type, date_range_kind, frequency, delivery_time, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.reportType ?? "time-and-activity",
      input.name ?? null,
      input.memberId ?? null,
      input.emails,
      input.subject ?? null,
      input.message ?? null,
      input.fileType,
      input.dateRangeKind,
      input.frequency,
      input.deliveryTime,
      input.createdBy,
    ],
  );
  return rows[0]?.id ?? null;
}

/** @param {string} reportType */
export async function listReportSchedulesPg(reportType = "time-and-activity") {
  return query(`SELECT * FROM report_schedules WHERE report_type = $1 ORDER BY created_at ASC`, [reportType]);
}

/** @param {string} id */
export async function markReportScheduleSentPg(id) {
  await query(`UPDATE report_schedules SET last_sent_at = now(), updated_at = now() WHERE id = $1`, [id]);
}
