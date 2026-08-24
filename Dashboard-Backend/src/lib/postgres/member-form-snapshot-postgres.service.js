// One JSON snapshot of a member's own profile-form submission, keyed by
// member. Moved off Firestore's members_field_data (type ===
// "memberFormSnapshot") - that table had a Postgres twin of the same name
// with nobody reading or writing it, exactly like access_requests.
import crypto from "node:crypto";
import { query } from "./client.js";

const FORM_KEY = "memberFormSnapshot";

function toRow(row) {
  return {
    id: row.id,
    type: FORM_KEY,
    recordType: FORM_KEY,
    memberDocId: row.member_id,
    modifiedBy: row.modified_by ?? "",
    formData: row.data ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** @param {string} [memberId] Omit to list every member's snapshot. */
export async function listMemberFormSnapshotsPg(memberId) {
  const rows = memberId
    ? await query(
        "SELECT * FROM members_field_data WHERE form_key = $1 AND member_id = $2 LIMIT 200",
        [FORM_KEY, memberId],
      )
    : await query("SELECT * FROM members_field_data WHERE form_key = $1 LIMIT 200", [FORM_KEY]);
  return rows.map(toRow);
}

/**
 * @param {string} memberId
 * @param {Record<string, unknown>} formData
 * @param {string} [modifiedBy]
 */
export async function upsertMemberFormSnapshotPg(memberId, formData, modifiedBy = "") {
  const rows = await query(
    `INSERT INTO members_field_data (id, member_id, form_key, data, modified_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now(), now())
     ON CONFLICT (member_id, form_key) DO UPDATE SET
       data = EXCLUDED.data, modified_by = EXCLUDED.modified_by, updated_at = now()
     RETURNING id`,
    [crypto.randomUUID(), memberId, FORM_KEY, JSON.stringify(formData ?? {}), modifiedBy || null],
  );
  return rows[0]?.id;
}

/** @param {string} memberId */
export async function deleteMemberFormSnapshotPg(memberId) {
  await query("DELETE FROM members_field_data WHERE form_key = $1 AND member_id = $2", [FORM_KEY, memberId]);
}
