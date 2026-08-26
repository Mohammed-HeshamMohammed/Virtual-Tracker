// Postgres-backed CRUD for member identity (see ensure-lookup-schema.js's
// `members` table comment for why this exists and what it replaces).
//
// Row shape intentionally mirrors what a Firestore members doc looked like
// (id + snake_case fields, no nested driver-specific wrapper). Real call
// sites build a plain object with the literal Firestore field names
// (first_name, work_email, ...) and used to hand it straight to
// `.doc(id).set(payload)` — so create/update here accept that same
// snake_case shape directly, not a translated camelCase API. That is the
// actual "smallest possible diff" for the ~150 call sites this table
// replaces, not a redesigned interface those call sites would all need to
// learn.
//
// date_added/updated_at are deliberately not writable through patch/data —
// the column defaults (now()) and the update trigger already do the right
// thing, and accepting a caller's `new Date()` here would just be one more
// way for a stale client clock to win over the database's.

import crypto from "node:crypto";
import { query } from "./client.js";
import { publishChange } from "../../modules/realtime/change-bus.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

/** Every writable column except id/date_added/updated_at (see file header). */
const WRITABLE_COLUMNS = [
  "firebase_uid",
  "first_name",
  "last_name",
  "display_name",
  "must_change_password",
  "work_email",
  "personal_email",
  "employee_id",
  "phone_number",
  "phone_verified",
  "ip_address",
  "avatar_url",
  "avatar_color",
  "status",
  "role_id",
  "hierarchy_status",
  "hierarchy_entitlements",
  "privileges",
  "independent_hierarchy",
  "hierarchy_status_updated_at",
  "roles_updated_at",
  "info_updated_at",
  "last_seen_at",
  "profile_linked_records_at",
  "banned_at",
  "registration_invite_kind",
  "created_by",
  "created_by_uid",
  "updated_by",
  "migrated_from_auth",
  "migrated_at",
  "migrated_by",
  "desktop_agent_linked_at",
  "web_capture_linked_at",
  "agent_source",
  "privileged_role_owner_granted",
  "privileged_role_owner_granted_at",
  // Drives per-member local-day attribution in the Activity feeds, so it has
  // to be writable through the normal member-update path and not only via
  // profile-settings.js's own raw UPDATE.
  "timezone",
];

const JSONB_COLUMNS = new Set(["hierarchy_entitlements", "privileges"]);

/** @param {Record<string, unknown>} data */
export async function createMemberPg(data) {
  const id = data.id ? uuidOrNull(data.id) ?? crypto.randomUUID() : crypto.randomUUID();
  const columns = ["id"];
  const placeholders = ["$1"];
  const params = [id];

  for (const column of WRITABLE_COLUMNS) {
    if (!(column in data)) continue;
    columns.push(column);
    params.push(JSONB_COLUMNS.has(column) ? JSON.stringify(data[column] ?? {}) : data[column]);
    placeholders.push(`$${params.length}`);
  }

  const rows = await query(
    `INSERT INTO members (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    params,
  );
  const created = rows[0] ?? null;
  if (created) void publishChange("members", String(created.id), "created", uuidOrNull(data.created_by) ?? undefined);
  return created;
}

/** @param {string} id */
export async function getMemberByIdPg(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM members WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

/** @param {string} firebaseUid */
export async function getMemberByFirebaseUidPg(firebaseUid) {
  if (!firebaseUid) return null;
  const rows = await query("SELECT * FROM members WHERE firebase_uid = $1 LIMIT 1", [firebaseUid]);
  return rows[0] ?? null;
}

/** @param {string} firebaseUid */
export async function getMemberAuthContextPg(firebaseUid) {
  if (!firebaseUid) return null;
  const sql = `
    SELECT 
      m.id,
      m.id AS member_id,
      m.firebase_uid,
      m.work_email,
      m.status,
      m.security_stamp,
      m.must_change_password,
      r.id AS role_id,
      COALESCE(r.name, 'Viewer') AS role_name,
      COALESCE(r.hierarchy_level, 10) AS hierarchy_level,
      COALESCE(r.is_management, false) AS is_management
    FROM members m
    LEFT JOIN roles r ON r.id = m.role_id
    WHERE m.firebase_uid = $1 LIMIT 1
  `;
  const rows = await query(sql, [firebaseUid]);
  return rows[0] ?? null;
}

/** @param {string[]} ids */
export async function getMembersByIdsPg(ids) {
  const clean = [...new Set((ids ?? []).map((id) => uuidOrNull(id)).filter(Boolean))];
  if (clean.length === 0) return [];
  return query("SELECT * FROM members WHERE id = ANY($1::uuid[])", [clean]);
}

/** @param {{ status?: string, limit?: number }} [options] */
export async function listMembersPg(options = {}) {
  const limit = Math.min(Math.max(options.limit ?? 2000, 1), 5000);
  if (options.status) {
    return query("SELECT * FROM members WHERE status = $1 ORDER BY date_added DESC LIMIT $2", [
      options.status,
      limit,
    ]);
  }
  return query("SELECT * FROM members ORDER BY date_added DESC LIMIT $1", [limit]);
}

// Every v_members_enriched column the members list actually needs. Explicit
// rather than SELECT * so security_stamp (a session-invalidation token, never
// read client-side) does not ride along to the browser.
const MEMBER_LIST_COLUMNS = [
  "id",
  "firebase_uid",
  "first_name",
  "last_name",
  "display_name",
  "work_email",
  "personal_email",
  "status",
  "avatar_url",
  "avatar_color",
  "date_added",
  "role_id",
  "role_name",
  "hierarchy_level",
  "is_management",
  "pay_rate",
  "pay_period",
  "weekly_limit",
  "daily_limit",
  "teams",
  "projects",
].join(", ");

/**
 * @param {{ viewer: any, limit?: number, visibleIds?: string[] | null }} options
 *   visibleIds - the caller's getVisibleMemberIds(...) result. null means
 *   "unrestricted" (Owner/Super Admin/Admin); an array is the exact set of
 *   member ids this viewer may see, and is authoritative for every other role
 *   including Manager/Super Manager.
 */
export async function listMembersEnrichedPg({ viewer, limit = 500, visibleIds = null }) {
  const safeLimit = Math.min(Math.max(limit, 1), 2000);
  const isSuper = typeof viewer?.hierarchyLevel === "number" && viewer.hierarchyLevel >= 80;

  // Owner/Super Admin/Admin see the whole org - getVisibleMemberIds returns
  // null for them, meaning "unrestricted".
  if (isSuper || visibleIds === null) {
    return query(
      `SELECT ${MEMBER_LIST_COLUMNS} FROM v_members_enriched WHERE status != 'banned' ORDER BY date_added DESC LIMIT $1`,
      [safeLimit],
    );
  }

  // Everyone else is scoped to exactly the ids getVisibleMemberIds resolved.
  // This deliberately does NOT re-derive scope in SQL: the management branch
  // here used to run fn_get_subordinate_member_ids, a descendants-only subtree,
  // while every other manager-scoped surface (the members tree, canManageMember,
  // scoped-members, reports) goes through getManagerPeoplePageVisibleMemberIds -
  // which also includes read-only upline, peer org-leadership, and members an
  // Owner/Admin attached outside the manager's subtree. A manager's People page
  // therefore disagreed with their own People tree about who exists. One
  // resolver, one answer.
  if (!Array.isArray(visibleIds) || visibleIds.length === 0) return [];
  return query(
    `SELECT ${MEMBER_LIST_COLUMNS} FROM v_members_enriched
     WHERE id = ANY($1::uuid[]) AND status != 'banned'
     ORDER BY date_added DESC LIMIT $2`,
    [visibleIds, safeLimit]
  );
}

/**
 * Keyset pagination on (date_added, id) — stable even when two rows share a
 * date_added exactly, unlike a plain date_added cursor. Mirrors the shape
 * the old Firestore .startAfter(cursorSnap) cursor gave callers: pass the
 * previous page's last row id back in as cursorId to get the next page.
 * @param {{ limit: number, cursorId?: string | null }} options
 */
export async function listMembersPagePg({ limit, cursorId }) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  if (cursorId) {
    const cursor = await getMemberByIdPg(cursorId);
    if (cursor) {
      return query(
        `SELECT * FROM members
         WHERE (date_added, id) < ($1, $2)
         ORDER BY date_added DESC, id DESC
         LIMIT $3`,
        [cursor.date_added, cursor.id, safeLimit],
      );
    }
  }
  return query("SELECT * FROM members ORDER BY date_added DESC, id DESC LIMIT $1", [safeLimit]);
}

/** @param {string} id @param {Record<string, unknown>} patch */
export async function updateMemberPg(id, patch) {
  const sets = [];
  const params = [id];
  for (const column of WRITABLE_COLUMNS) {
    if (!(column in patch)) continue;
    params.push(JSONB_COLUMNS.has(column) ? JSON.stringify(patch[column] ?? {}) : patch[column]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getMemberByIdPg(id);
  sets.push("updated_at = now()");
  const rows = await query(`UPDATE members SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  const updated = rows[0] ?? null;
  if (updated) void publishChange("members", String(updated.id), "updated", uuidOrNull(patch.updated_by) ?? undefined);
  return updated;
}

/**
 * @param {string} id
 * @param {string} [actorId]
 */
export async function deleteMemberPg(id, actorId) {
  await query("DELETE FROM members WHERE id = $1", [id]);
  void publishChange("members", String(id), "deleted", actorId ?? undefined);
}

/**
 * True O(1) uid -> memberId resolution, replacing the old
 * member_auth_index-then-fallback-scan pair with one indexed lookup.
 * @param {string} firebaseUid
 * @returns {Promise<string>}
 */
export async function resolveMemberIdForFirebaseUidPg(firebaseUid) {
  const member = await getMemberByFirebaseUidPg(firebaseUid);
  return member ? String(member.id) : "";
}

/**
 * Checks if a member has a permission key via role_permissions in PostgreSQL.
 * @param {string} memberId
 * @param {string} permKey
 * @returns {Promise<boolean>}
 */
export async function hasMemberPermissionPg(memberId, permKey) {
  if (!memberId || !permKey) return false;
  const rows = await query("SELECT fn_member_has_permission($1, $2) AS allowed", [memberId, permKey]);
  return rows[0]?.allowed === true;
}

/**
 * Invalidates all active sessions for a member by changing their security stamp.
 * @param {string} memberId
 * @returns {Promise<string>} new security stamp
 */
export async function revokeAllMemberSessionsPg(memberId) {
  if (!memberId) return "";
  const newStamp = crypto.randomUUID();
  await query("UPDATE members SET security_stamp = $1, updated_at = now() WHERE id = $2", [newStamp, memberId]);
  return newStamp;
}
