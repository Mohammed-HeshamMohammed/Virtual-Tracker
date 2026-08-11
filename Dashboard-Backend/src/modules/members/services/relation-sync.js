import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  isPostgresLookupReady,
  resetPostgresLookupReadyCache,
} from "../../../lib/postgres/lookup-availability.js";
import { logSafeWarn } from "../../../http/sanitize-error.js";
import {
  ensureDefaultRolesPg,
  resolveRoleIdByNamePg,
  resolveRoleNameByIdPg,
} from "../../../lib/postgres/lookup-postgres.service.js";
import { getLookupData } from "../../../lib/postgres/lookup-cache.js";
import { deactivationGovernanceForRole } from "../../../http/role-hierarchy.js";
import { validateOwnerRoleChange } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";
import { addProjectMemberPg, listProjectIdsForMemberPg, removeProjectMemberPg } from "../../../lib/postgres/projects-postgres.service.js";
import { query as pgQuery, isPostgresConfigured } from "../../../lib/postgres/client.js";
import { getMemberByIdPg, getMembersByIdsPg, updateMemberPg } from "../../../lib/postgres/members-postgres.service.js";

const DEFAULT_ROLES = ["Owner", "Super Admin", "Admin", "Super Manager", "Manager", "Employee L2", "Employee L1", "Employee L0", "Client", "Viewer"];

/**
 * Role name by id (Postgres lookup).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} roleId
 */
export async function resolveRoleNameById(db, roleId) {
  if (typeof roleId !== "string" || !roleId) return "";
  await isPostgresLookupReady();
  return await resolveRoleNameByIdPg(roleId);
}

/**
 * Role id by name (Postgres lookup).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} roleName
 * @returns {Promise<string>}
 */
export async function resolveRoleIdByName(db, roleName) {
  const name = typeof roleName === "string" && roleName.trim() ? roleName.trim() : "User";
  await isPostgresLookupReady();
  return await resolveRoleIdByNamePg(name);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function ensureDefaultRoles(db) {
  await isPostgresLookupReady();
  await ensureDefaultRolesPg(DEFAULT_ROLES);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @param {string} [assignedBy]
 * @returns {Promise<string>}
 */
export async function syncMemberPrimaryRole(db, memberId, roleName, assignedBy = "", actorRoleName = "") {
  const trimmedName = typeof roleName === "string" && roleName.trim() ? roleName.trim() : "Viewer";
  const currentRoleName = await resolveMemberRoleName(db, memberId);
  const ownerErr = validateOwnerRoleChange(currentRoleName, trimmedName);
  if (ownerErr) throw new Error(ownerErr);

  const roleId = await resolveRoleIdByName(db, trimmedName);

  await updateMemberPg(memberId, {
    role_id: roleId,
    deactivation_governance: deactivationGovernanceForRole(trimmedName),
    updated_at: new Date().toISOString(),
    ...(assignedBy ? { updated_by: assignedBy } : {}),
  });

  const { syncPrivilegedRoleOwnerGrant } = await import("./privileged-role-governance.js");
  await syncPrivilegedRoleOwnerGrant(db, memberId, trimmedName, actorRoleName);

  const { invalidateMemberRoleCache } = await import("../../../http/role-cache.js");
  invalidateMemberRoleCache(memberId);
  if (isPostgresConfigured()) {
    const { revokeAllMemberSessionsPg } = await import("../../../lib/postgres/members-postgres.service.js");
    await revokeAllMemberSessionsPg(memberId).catch(() => {});
  }

  return roleId;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function loadRoleNameById(db) {
  if (!(await isPostgresLookupReady())) return new Map();
  const data = await getLookupData();
  return new Map(
    data.roles.map((row) => [String(row.id), typeof row.name === "string" ? row.name.trim() : ""]),
  );
}

/**
 * Role ids whose Postgres `roles.name` satisfies `predicate` - the shared
 * "which members have an admin/management/employee-tier role" query. Every
 * call site that needs this used to run its own `db.collection("roles")`
 * Firestore scan; that collection has had nothing writing to it since roles
 * moved to Postgres (see resolveRoleIdByNamePg/ensureDefaultRolesPg), so
 * those reads were silently returning empty/stale results. This hits the
 * same 5-minute-cached `roles` table every other role lookup in the app uses.
 * @param {(roleName: string) => boolean} predicate
 * @returns {Promise<string[]>}
 */
export async function resolveRoleIdsWhere(predicate) {
  if (!(await isPostgresLookupReady())) return [];
  const { roles } = await getLookupData();
  return roles
    .filter((row) => predicate(typeof row.name === "string" ? row.name.trim() : ""))
    .map((row) => String(row.id));
}

/**
 * @param {string} roleId
 * @param {Map<string, string>} roleNameById
 */
function roleNameFromId(roleId, roleNameById) {
  if (!roleId) return "";
  return roleNameById.get(roleId) || "";
}

/** Higher rank wins when `members.role_id` and `member_roles` disagree (e.g. stale assignments). */
export const ROLE_PRIVILEGE_RANK = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  employeel2: 50,
  employeel1: 40,
  employeel0: 30,
  employee: 30, // Legacy fallback: bare "Employee" treated as Employee L0
  client: 20,
  viewer: 10,
};

/**
 * @param {string} roleName
 */
export function normalizeRoleKey(roleName) {
  return typeof roleName === "string" ? roleName.trim().toLowerCase().replace(/\s+/g, "") : "";
}

/**
 * @param {string} roleName
 */
export function rolePrivilegeRank(roleName) {
  const key = normalizeRoleKey(roleName);
  if (!key) return -1;
  return ROLE_PRIVILEGE_RANK[key] ?? 35;
}

/**
 * @param {string[]} candidates
 */
export function pickHighestPrivilegeRoleName(candidates) {
  let bestName = "";
  let bestRank = -1;
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const rank = rolePrivilegeRank(trimmed);
    if (rank > bestRank) {
      bestRank = rank;
      bestName = trimmed;
    }
  }
  // Normalize legacy bare "Employee" to "Employee L0"
  if (bestName && normalizeRoleKey(bestName) === "employee") {
    bestName = "Employee L0";
  }
  return bestName || "Viewer";
}

/**
 * Primary role from members + member_roles. On conflict, higher privilege wins.
 * @param {Record<string, unknown>} memberData
 * @param {Array<Record<string, unknown>>} memberRoleRows
 * @param {Map<string, string>} roleNameById
 */
export function pickCanonicalPrimaryRoleName(memberData, memberRoleRows = [], roleNameById) {
  const memberRoleId = typeof memberData.role_id === "string" ? memberData.role_id : "";
  const memberRoleName = roleNameFromId(memberRoleId, roleNameById);
  return { name: memberRoleName || "Viewer", roleId: memberRoleId };
}

/**
 * Keep members.role_id and roles table in sync.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} [assignedBy]
 * @returns {Promise<string|null>} canonical role_id
 */
export async function alignMemberRoleTables(db, memberId, assignedBy = "role-align") {
  if (!memberId) return null;
  const { invalidateMemberRoleCache } = await import("../../../http/role-cache.js");
  const [memberData, roleNameById] = await Promise.all([
    getMemberByIdPg(memberId),
    loadRoleNameById(db),
  ]);
  if (!memberData) return null;
  const { name } = pickCanonicalPrimaryRoleName(memberData, [], roleNameById);
  const currentRoleId = typeof memberData.role_id === "string" ? memberData.role_id : "";
  const alignedRoleId =
    currentRoleId && roleNameFromId(currentRoleId, roleNameById) === name
      ? currentRoleId
      : await resolveRoleIdByName(db, name);
  if (currentRoleId && currentRoleId === alignedRoleId) {
    invalidateMemberRoleCache(memberId);
    return currentRoleId;
  }
  const roleId = await syncMemberPrimaryRole(db, memberId, name, assignedBy);
  invalidateMemberRoleCache(memberId);
  return roleId;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 * @param {string[]} projectIds
 * @param {string} [createdBy]
 */
export async function syncInviteProjects(_db, inviteId, projectIds, createdBy = "") {
  const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))];
  const existingRows = await pgQuery("SELECT id, project_id FROM invite_projects WHERE invite_id = $1", [inviteId]);
  const existingIds = new Set();
  for (const row of existingRows) {
    if (typeof row.project_id !== "string") continue;
    existingIds.add(row.project_id);
    if (!ids.includes(row.project_id)) {
      await pgQuery("DELETE FROM invite_projects WHERE id = $1", [row.id]);
    }
  }
  for (const projectId of ids) {
    if (existingIds.has(projectId)) continue;
    await pgQuery(
      "INSERT INTO invite_projects (id, invite_id, project_id, created_by) VALUES ($1,$2,$3,$4)",
      [crypto.randomUUID(), inviteId, projectId, typeof createdBy === "string" && createdBy.trim() ? createdBy.trim() : null],
    );
  }
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} pendingUid
 * @param {string[]} projectIds
 */
export async function syncPendingAuthProjects(_db, pendingUid, projectIds) {
  const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))];
  const existingRows = await pgQuery(
    "SELECT id, project_id FROM pending_auth_projects WHERE firebase_uid = $1",
    [pendingUid],
  );
  const existingIds = new Set();
  for (const row of existingRows) {
    if (typeof row.project_id !== "string") continue;
    existingIds.add(row.project_id);
    if (!ids.includes(row.project_id)) {
      await pgQuery("DELETE FROM pending_auth_projects WHERE id = $1", [row.id]);
    }
  }
  for (const projectId of ids) {
    if (existingIds.has(projectId)) continue;
    await pgQuery(
      "INSERT INTO pending_auth_projects (id, firebase_uid, project_id) VALUES ($1,$2,$3)",
      [crypto.randomUUID(), pendingUid, projectId],
    );
  }
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 * @returns {Promise<string[]>}
 */
export async function getInviteProjectIds(_db, inviteId) {
  const rows = await pgQuery("SELECT project_id FROM invite_projects WHERE invite_id = $1", [inviteId]);
  return rows.map((r) => r.project_id).filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} pendingUid
 * @returns {Promise<string[]>}
 */
export async function getPendingAuthProjectIds(_db, pendingUid) {
  const rows = await pgQuery("SELECT project_id FROM pending_auth_projects WHERE firebase_uid = $1", [pendingUid]);
  return rows.map((r) => r.project_id).filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string[]} projectIds
 * @param {string} [assignedBy]
 */
export async function syncProjectMembersForMember(db, memberId, projectIds, assignedBy = "") {
  const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))];
  const existingIds = new Set(await listProjectIdsForMemberPg(memberId));
  for (const projectId of existingIds) {
    if (!ids.includes(projectId)) await removeProjectMemberPg(projectId, memberId);
  }
  for (const projectId of ids) {
    if (existingIds.has(projectId)) continue;
    await addProjectMemberPg(projectId, memberId, { actorId: assignedBy || null });
  }
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 */
export async function deleteInviteProjects(_db, inviteId) {
  await pgQuery("DELETE FROM invite_projects WHERE invite_id = $1", [inviteId]);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} pendingUid
 */
export async function deletePendingAuthProjects(_db, pendingUid) {
  await pgQuery("DELETE FROM pending_auth_projects WHERE firebase_uid = $1", [pendingUid]);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function cascadeDeleteMemberRelations(db, memberId) {
  if (!memberId) return;
  await Promise.all([
    pgQuery("DELETE FROM team_members WHERE member_id = $1", [memberId]),
    pgQuery("DELETE FROM project_members WHERE member_id = $1", [memberId]),
  ]);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<{ id: string, role?: string }>} members
 */
export async function enrichMembersWithRoleNames(db, members) {
  if (!members.length) return members;
  const roleNameById = new Map();
  if (await isPostgresLookupReady()) {
    try {
      const { roles } = await getLookupData();
      for (const row of roles) {
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (row.id != null) roleNameById.set(String(row.id), name);
      }
    } catch {
      // Fall back safely if lookup read fails
    }
  }
  return members.map((member) => {
    const { name, roleId } = pickCanonicalPrimaryRoleName(member, [], roleNameById);
    return {
      ...member,
      role_name: name,
      role: name,
      role_id: roleId || (typeof member.role_id === "string" ? member.role_id : ""),
    };
  });
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<{ id: string }>} invites
 */
export async function enrichInvitesWithProjectCounts(_db, invites) {
  if (!invites.length) return invites;
  const inviteIdSet = new Set(invites.map((row) => row.id).filter((id) => !String(id).startsWith("pa_")));
  const rows = await pgQuery("SELECT invite_id FROM invite_projects LIMIT 2000");
  const countByInvite = new Map();
  for (const row of rows) {
    const inviteId = row.invite_id;
    if (typeof inviteId !== "string" || !inviteIdSet.has(inviteId)) continue;
    countByInvite.set(inviteId, (countByInvite.get(inviteId) || 0) + 1);
  }

  const pendingUids = invites
    .map((row) => row.id)
    .filter((id) => typeof id === "string" && id.startsWith("pa_"))
    .map((id) => id.slice(3));
  const pendingCountByUid = new Map();
  if (pendingUids.length > 0) {
    const pendingRows = await pgQuery("SELECT firebase_uid FROM pending_auth_projects LIMIT 2000");
    for (const row of pendingRows) {
      const uid = row.firebase_uid;
      if (typeof uid !== "string" || !pendingUids.includes(uid)) continue;
      pendingCountByUid.set(uid, (pendingCountByUid.get(uid) || 0) + 1);
    }
  }

  return invites.map((row) => {
    if (String(row.id).startsWith("pa_")) {
      const uid = String(row.id).slice(3);
      return { ...row, project_count: pendingCountByUid.get(uid) ?? 0 };
    }
    return { ...row, project_count: countByInvite.get(row.id) ?? 0 };
  });
}

const TEAM_MEMBER_AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function memberProfileFromDoc(data) {
  const first = typeof data.first_name === "string" ? data.first_name : "";
  const last = typeof data.last_name === "string" ? data.last_name : "";
  const name = `${first} ${last}`.trim() || "Unnamed member";
  const initials =
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  const email =
    (typeof data.work_email === "string" && data.work_email) ||
    (typeof data.personal_email === "string" && data.personal_email) ||
    "";
  const avatarColor =
    typeof data.avatar_color === "string" && data.avatar_color ? data.avatar_color : null;
  return { name, initials, email, avatarColor };
}

/**
 * Display fields for task/team assignment UIs.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<Record<string, unknown>>} rows
 */
export async function enrichTeamMembersWithProfiles(db, rows) {
  if (!rows.length) return rows;

  const memberIds = [
    ...new Set(
      rows
        .map((row) => (typeof row.member_id === "string" ? row.member_id : ""))
        .filter(Boolean),
    ),
  ];
  const profileByMemberId = new Map();
  const roleByMemberId = new Map();

  const roleNameById = new Map();
  if (await isPostgresLookupReady()) {
    try {
      const { roles } = await getLookupData();
      for (const row of roles) {
        if (row.id != null) roleNameById.set(String(row.id), typeof row.name === "string" ? row.name.trim() : "");
      }
    } catch {
      // Fall back safely if lookup read fails
    }
  }

  if (memberIds.length > 0) {
    try {
      const memberRows = await getMembersByIdsPg(memberIds);
      for (const data of memberRows) {
        if (!data || !data.id) continue;
        profileByMemberId.set(data.id, memberProfileFromDoc(data));
        const { name } = pickCanonicalPrimaryRoleName(
          data,
          [],
          roleNameById,
        );
        if (name) roleByMemberId.set(data.id, name);
      }
    } catch {
      // Fall back safely if members lookup fails
    }
  }

  return rows.map((row, index) => {
    const memberId = typeof row.member_id === "string" ? row.member_id : "";
    const profile = memberId ? profileByMemberId.get(memberId) : undefined;
    const fallbackColor = TEAM_MEMBER_AVATAR_COLORS[index % TEAM_MEMBER_AVATAR_COLORS.length];
    return {
      ...row,
      member_name: profile?.name ?? null,
      member_avatar: profile?.initials ?? null,
      member_email: profile?.email ?? null,
      member_color: profile?.avatarColor ?? fallbackColor,
      member_role: roleByMemberId.get(memberId) ?? null,
    };
  });
}

/**
 * Project names on team-project relation rows.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<Record<string, unknown>>} rows
 */
export async function enrichTeamProjectsWithNames(db, rows) {
  if (!rows.length) return rows;

  const projectIds = [
    ...new Set(
      rows
        .map(
          (row) =>
            (typeof row.project_id === "string" && row.project_id) ||
            (typeof row.projectId === "string" && row.projectId) ||
            "",
        )
        .filter(Boolean),
    ),
  ];
  const nameByProjectId = new Map();
  if (projectIds.length > 0) {
    try {
      const projectRows = await pgQuery("SELECT id, name FROM projects WHERE id = ANY($1::uuid[])", [projectIds]);
      for (const row of projectRows) {
        const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
        if (name) nameByProjectId.set(row.id, name);
      }
    } catch {
      // Fall back safely if projects lookup fails
    }
  }

  return rows.map((row) => {
    const projectId =
      (typeof row.project_id === "string" && row.project_id) ||
      (typeof row.projectId === "string" && row.projectId) ||
      "";
    return {
      ...row,
      project_name: projectId ? nameByProjectId.get(projectId) ?? null : null,
    };
  });
}
