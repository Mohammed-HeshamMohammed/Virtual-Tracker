import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "../../../lib/firestore/collections.js";
import { deactivationGovernanceForRole } from "../../../http/role-hierarchy.js";
import { validateOwnerRoleChange } from "../../../http/role-owner-policy.js";
import { resolveMemberRoleName } from "../../activity/activity-scope.js";

const DEFAULT_ROLES = ["Owner", "Super Admin", "Admin", "Super Manager", "Manager", "Employee L2", "Employee L1", "Employee L0", "Client", "Viewer"];

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} roleName
 * @returns {Promise<string>}
 */
/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} roleId
 */
export async function resolveRoleNameById(db, roleId) {
  if (typeof roleId !== "string" || !roleId) return "";
  const doc = await db.collection("roles").doc(roleId).get();
  if (!doc.exists) return "";
  const name = doc.data()?.name;
  return typeof name === "string" ? name.trim() : "";
}

export async function resolveRoleIdByName(db, roleName) {
  const name = typeof roleName === "string" && roleName.trim() ? roleName.trim() : "User";
  const exact = await db.collection("roles").where("name", "==", name).limit(1).get();
  if (!exact.empty) return exact.docs[0].id;

  const snap = await db.collection("roles").limit(100).get();
  for (const doc of snap.docs) {
    const rowName = doc.data()?.name;
    if (typeof rowName === "string" && rowName.toLowerCase() === name.toLowerCase()) return doc.id;
  }

  const id = crypto.randomUUID();
  await db.collection("roles").doc(id).set({
    id,
    name,
    description: "",
    created_at: new Date(),
    created_by: "",
    updated_by: "",
  });
  return id;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function ensureDefaultRoles(db) {
  const snap = await db.collection("roles").limit(100).get();
  const existing = new Set(
    snap.docs
      .map((doc) => doc.data()?.name)
      .filter((name) => typeof name === "string")
      .map((name) => name.toLowerCase()),
  );
  for (const name of DEFAULT_ROLES) {
    if (existing.has(name.toLowerCase())) continue;
    await resolveRoleIdByName(db, name);
  }
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

  const memberMerge = {
    role_id: roleId,
    role_name: FieldValue.delete(),
    role: FieldValue.delete(),
    roles: FieldValue.delete(),
    member_roles: FieldValue.delete(),
    members_roles: FieldValue.delete(),
    deactivation_governance: deactivationGovernanceForRole(trimmedName),
    updated_at: new Date(),
  };
  if (assignedBy) memberMerge.updated_by = assignedBy;
  await db.collection("members").doc(memberId).set(memberMerge, { merge: true });

  const { syncPrivilegedRoleOwnerGrant } = await import("./privileged-role-governance.js");
  await syncPrivilegedRoleOwnerGrant(db, memberId, trimmedName, actorRoleName);

  const { invalidateMemberRoleCache } = await import("../../../http/role-cache.js");
  invalidateMemberRoleCache(memberId);

  return roleId;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 */
async function loadRoleNameById(db) {
  const snap = await db.collection("roles").limit(100).get();
  return new Map(
    snap.docs.map((doc) => {
      const row = doc.data() || {};
      return [doc.id, typeof row.name === "string" ? row.name.trim() : ""];
    }),
  );
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
 * Resolve the canonical primary role for a member from `members` + `member_roles` (+ `roles`).
 * When sources disagree, keeps the highest-privilege name (so seed `member_roles` beats stale `User` on `members`).
 *
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
 * Force `members` and `roles` to agree on one primary role.
 * Safe to call after login, profile save, or schema edits.
 *
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} [assignedBy]
 * @returns {Promise<string|null>} canonical role_id
 */
export async function alignMemberRoleTables(db, memberId, assignedBy = "role-align") {
  if (!memberId) return null;
  const { invalidateMemberRoleCache } = await import("../../../http/role-cache.js");
  const [memberSnap, roleNameById] = await Promise.all([
    db.collection("members").doc(memberId).get(),
    loadRoleNameById(db),
  ]);
  if (!memberSnap.exists) return null;

  const memberData = memberSnap.data() || {};
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
export async function syncInviteProjects(db, inviteId, projectIds, createdBy = "") {
  const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))];
  const existing = await db.collection("invite_projects").where("invite_id", "==", inviteId).get();
  const batch = db.batch();
  const existingIds = new Set();
  for (const doc of existing.docs) {
    const projectId = doc.data()?.project_id;
    if (typeof projectId !== "string") continue;
    existingIds.add(projectId);
    if (!ids.includes(projectId)) batch.delete(doc.ref);
  }
  for (const projectId of ids) {
    if (existingIds.has(projectId)) continue;
    const id = crypto.randomUUID();
    batch.set(db.collection("invite_projects").doc(id), {
      id,
      invite_id: inviteId,
      project_id: projectId,
      created_by: createdBy,
    });
  }
  if (existing.docs.length > 0 || ids.length > 0) await batch.commit();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} pendingUid
 * @param {string[]} projectIds
 */
export async function syncPendingAuthProjects(db, pendingUid, projectIds) {
  const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))];
  const existing = await db.collection("pending_auth_projects").where("pending_uid", "==", pendingUid).get();
  const batch = db.batch();
  const existingIds = new Set();
  for (const doc of existing.docs) {
    const projectId = doc.data()?.project_id;
    if (typeof projectId !== "string") continue;
    existingIds.add(projectId);
    if (!ids.includes(projectId)) batch.delete(doc.ref);
  }
  for (const projectId of ids) {
    if (existingIds.has(projectId)) continue;
    const id = crypto.randomUUID();
    batch.set(db.collection("pending_auth_projects").doc(id), {
      id,
      pending_uid: pendingUid,
      project_id: projectId,
      created_at: new Date(),
    });
  }
  if (existing.docs.length > 0 || ids.length > 0) await batch.commit();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 * @returns {Promise<string[]>}
 */
export async function getInviteProjectIds(db, inviteId) {
  const snap = await db.collection("invite_projects").where("invite_id", "==", inviteId).get();
  return snap.docs
    .map((doc) => doc.data()?.project_id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} pendingUid
 * @returns {Promise<string[]>}
 */
export async function getPendingAuthProjectIds(db, pendingUid) {
  const snap = await db.collection("pending_auth_projects").where("pending_uid", "==", pendingUid).get();
  return snap.docs
    .map((doc) => doc.data()?.project_id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string[]} projectIds
 * @param {string} [assignedBy]
 */
export async function syncProjectMembersForMember(db, memberId, projectIds, assignedBy = "") {
  const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))];
  const existing = await db.collection("project_members").where("member_id", "==", memberId).get();
  const batch = db.batch();
  const existingIds = new Set();
  for (const doc of existing.docs) {
    const projectId = doc.data()?.project_id;
    if (typeof projectId !== "string") continue;
    existingIds.add(projectId);
    if (!ids.includes(projectId)) batch.delete(doc.ref);
  }
  for (const projectId of ids) {
    if (existingIds.has(projectId)) continue;
    const id = crypto.randomUUID();
    batch.set(db.collection("project_members").doc(id), {
      id,
      member_id: memberId,
      project_id: projectId,
      assigned_at: new Date(),
      assigned_by: assignedBy,
    });
  }
  if (existing.docs.length > 0 || ids.length > 0) await batch.commit();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} inviteId
 */
export async function deleteInviteProjects(db, inviteId) {
  const snap = await db.collection("invite_projects").where("invite_id", "==", inviteId).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} pendingUid
 */
export async function deletePendingAuthProjects(db, pendingUid) {
  const snap = await db.collection("pending_auth_projects").where("pending_uid", "==", pendingUid).get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
export async function cascadeDeleteMemberRelations(db, memberId) {
  const [teamMembers, projectMembers] = await Promise.all([
    db.collection("team_members").where("member_id", "==", memberId).get(),
    db.collection("project_members").where("member_id", "==", memberId).get(),
  ]);
  const batch = db.batch();
  for (const doc of teamMembers.docs) batch.delete(doc.ref);
  for (const doc of projectMembers.docs) batch.delete(doc.ref);
  if (teamMembers.size + projectMembers.size > 0) await batch.commit();
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<{ id: string, role?: string }>} members
 */
export async function enrichMembersWithRoleNames(db, members) {
  if (!members.length) return members;
  const [rolesSnap] = await Promise.all([
    db.collection("roles").limit(100).get(),
  ]);
  const roleNameById = new Map(
    rolesSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return [doc.id, typeof row.name === "string" ? row.name.trim() : ""];
    }),
  );
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
export async function enrichInvitesWithProjectCounts(db, invites) {
  if (!invites.length) return invites;
  const inviteIdSet = new Set(invites.map((row) => row.id).filter((id) => !String(id).startsWith("pa_")));
  const snap = await db.collection("invite_projects").limit(2000).get();
  const countByInvite = new Map();
  for (const doc of snap.docs) {
    const inviteId = doc.data()?.invite_id;
    if (typeof inviteId !== "string" || !inviteIdSet.has(inviteId)) continue;
    countByInvite.set(inviteId, (countByInvite.get(inviteId) || 0) + 1);
  }

  const pendingUids = invites
    .map((row) => row.id)
    .filter((id) => typeof id === "string" && id.startsWith("pa_"))
    .map((id) => id.slice(3));
  const pendingCountByUid = new Map();
  if (pendingUids.length > 0) {
    const pendingSnap = await db.collection("pending_auth_projects").limit(2000).get();
    for (const doc of pendingSnap.docs) {
      const uid = doc.data()?.pending_uid;
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
 * Attach display fields for task assignment and team UIs.
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

  const rolesSnap = await db.collection("roles").limit(100).get();
  const roleNameById = new Map(
    rolesSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return [doc.id, typeof row.name === "string" ? row.name : ""];
    }),
  );

  for (let i = 0; i < memberIds.length; i += 30) {
    const chunk = memberIds.slice(i, i + 30);
    const refs = chunk.map((id) => db.collection("members").doc(id));
    const snaps = await db.getAll(...refs);

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      profileByMemberId.set(snap.id, memberProfileFromDoc(data));
      const { name } = pickCanonicalPrimaryRoleName(
        data,
        [],
        roleNameById,
      );
      if (name) roleByMemberId.set(snap.id, name);
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
 * Attach project display names for team-project relation rows.
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

  for (let i = 0; i < projectIds.length; i += 30) {
    const chunk = projectIds.slice(i, i + 30);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.projects).doc(id));
    const snaps = await db.getAll(...refs);

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
      if (name) nameByProjectId.set(snap.id, name);
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
