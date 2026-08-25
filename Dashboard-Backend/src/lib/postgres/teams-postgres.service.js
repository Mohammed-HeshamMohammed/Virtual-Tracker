// Postgres-backed CRUD for teams/team_members (see ensure-lookup-schema.js's
// teams comment for migration context). Same drop-in-row convention as
// members-postgres.service.js: snake_case keys straight through, no
// camelCase translation layer.

import crypto from "node:crypto";
import { query, withTransaction } from "./client.js";

function uuidOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// teams
// ---------------------------------------------------------------------------

const TEAM_COLUMNS = ["name", "schedule_weekly_report", "last_weekly_report_sent_at", "created_by", "updated_by"];

/** @param {Record<string, unknown>} data */
export async function createTeamPg(data) {
  const id = data.id ? uuidOrNull(data.id) ?? crypto.randomUUID() : crypto.randomUUID();
  const columns = ["id"];
  const placeholders = ["$1"];
  const params = [id];
  for (const column of TEAM_COLUMNS) {
    if (!(column in data)) continue;
    columns.push(column);
    params.push(data[column]);
    placeholders.push(`$${params.length}`);
  }
  const rows = await query(
    `INSERT INTO teams (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

/** @param {string} id */
export async function getTeamByIdPg(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM teams WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

/** @param {string[]} ids */
export async function getTeamsByIdsPg(ids) {
  const clean = [...new Set((ids ?? []).map(uuidOrNull).filter(Boolean))];
  if (clean.length === 0) return [];
  return query("SELECT * FROM teams WHERE id = ANY($1::uuid[])", [clean]);
}

export async function listTeamsPg() {
  return query("SELECT * FROM teams ORDER BY name ASC");
}

/** @param {string} id @param {Record<string, unknown>} patch */
export async function updateTeamPg(id, patch) {
  const sets = [];
  const params = [id];
  for (const column of TEAM_COLUMNS) {
    if (!(column in patch)) continue;
    params.push(patch[column]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getTeamByIdPg(id);
  const rows = await query(`UPDATE teams SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return rows[0] ?? null;
}

/** Team row delete only - roster/project links are the caller's job (see
 * deleteTeamProjectsForTeamPg in projects-postgres.service.js for why that
 * one in particular can't just be a cascade). team_members DOES cascade
 * (FK below), team_projects does not (team_id has no FK to non-cascade). */
export async function deleteTeamPg(id) {
  await query("DELETE FROM teams WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// team_members
// ---------------------------------------------------------------------------

// Roster reads carry the display fields the Teams page needs (member_name /
// _avatar / _color / _role) - without them every team renders a blank "Lead:"
// line and "UN" placeholder avatars. Deliberately NOT the v_team_rosters view:
// that view omits assigned_by/updated_by, and selects work_email, which is
// Owner/Super Admin-only under field-policy.js and has no business riding
// along on a roster read.
const TEAM_MEMBER_ENRICHED_SELECT = `
  SELECT tm.*,
         NULLIF(
           COALESCE(
             NULLIF(TRIM(m.display_name), ''),
             NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '')
           ),
           ''
         )               AS member_name,
         m.avatar_url    AS member_avatar_url,
         m.avatar_color  AS member_color,
         COALESCE(r.name, 'Viewer') AS member_role
  FROM team_members tm
  LEFT JOIN members m ON m.id = tm.member_id
  LEFT JOIN roles r ON r.id = m.role_id`;

/** @param {string} teamId */
export async function listTeamMembersPg(teamId) {
  if (!teamId) return [];
  return query(`${TEAM_MEMBER_ENRICHED_SELECT} WHERE tm.team_id = $1`, [teamId]);
}

/** @param {string} memberId */
export async function listTeamMembershipsForMemberPg(memberId) {
  if (!memberId) return [];
  return query("SELECT * FROM team_members WHERE member_id = $1", [memberId]);
}

export async function listAllTeamMembersPg() {
  return query(TEAM_MEMBER_ENRICHED_SELECT);
}

/** @param {{ team_id: string, member_id: string, is_lead?: boolean, assigned_by?: string, updated_by?: string }} data */
export async function addTeamMemberPg(data) {
  const id = crypto.randomUUID();
  const rows = await query(
    `INSERT INTO team_members (id, team_id, member_id, is_lead, assigned_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (team_id, member_id) DO UPDATE SET is_lead = EXCLUDED.is_lead, updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [id, data.team_id, data.member_id, data.is_lead ?? false, uuidOrNull(data.assigned_by), uuidOrNull(data.updated_by)],
  );
  return rows[0] ?? null;
}

/** @param {string} teamId @param {string} memberId */
export async function removeTeamMemberPg(teamId, memberId) {
  await query("DELETE FROM team_members WHERE team_id = $1 AND member_id = $2", [teamId, memberId]);
}

/** Replace a team's whole member roster in one transaction - mirrors the
 * Firestore batch.set()-per-row pattern syncTeamRoster used to run. */
export async function replaceTeamRosterPg(teamId, memberRows) {
  return withTransaction(async (client) => {
    await client.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
    for (const row of memberRows) {
      await client.query(
        `INSERT INTO team_members (id, team_id, member_id, is_lead, assigned_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          teamId,
          row.member_id,
          row.is_lead ?? false,
          uuidOrNull(row.assigned_by),
          uuidOrNull(row.updated_by),
        ],
      );
    }
  });
}
