import { isManagementRole } from "../../http/auth-context.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";
import { resolveMemberRoleNameCached } from "../../http/role-cache.js";
import { canCreateTransferRequests } from "../hierarchy/hierarchy-placement.js";
import { hasHierarchyAssignmentRestriction } from "../hierarchy/hierarchy-placement.js";
import { canCreateTeams } from "../../http/team-member-assign-policy.js";
import { enforcePrivilegedRoleGovernanceForMember } from "../members/services/privileged-role-governance.js";

const PROJECT_SCOPE_ROLES = new Set(["owner", "superadmin", "admin"]);
const ORG_TASK_CREATE_ROLES = new Set(["owner", "superadmin", "admin", "supermanager", "supermanger"]);

/** Mirrors frontend ROLE_PRIVILEGE_RANK in member-role-access.ts */
const ROLE_PRIVILEGE_RANK = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  employeel2: 50,
  employeel1: 40,
  employeel0: 30,
  employee: 30,
  client: 20,
  viewer: 10,
};

/**
 * @param {string} roleName
 */
function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * @param {string} roleName
 */
function roleRank(roleName) {
  return ROLE_PRIVILEGE_RANK[normalizeRole(roleName)] ?? -1;
}

/**
 * @param {string} roleName
 */
function canAccessAllSidebarTabs(roleName) {
  return isManagementRole(roleName);
}

/**
 * @param {string} roleName
 */
function defaultNavItemForRole(_roleName) {
  return "general";
}

/**
 * @param {Record<string, unknown> | null | undefined} memberData
 */
function buildMemberSummary(memberData, memberId, roleName) {
  const first = typeof memberData?.first_name === "string" ? memberData.first_name.trim() : "";
  const last = typeof memberData?.last_name === "string" ? memberData.last_name.trim() : "";
  const name =
    (typeof memberData?.name === "string" && memberData.name.trim()) ||
    [first, last].filter(Boolean).join(" ").trim() ||
    "Member";
  const email =
    (typeof memberData?.work_email === "string" && memberData.work_email) ||
    (typeof memberData?.email === "string" && memberData.email) ||
    "";
  return {
    id: memberId,
    name,
    email,
    status: typeof memberData?.status === "string" ? memberData.status : "active",
    role: roleName,
    role_name: roleName,
    hierarchy_status:
      typeof memberData?.hierarchy_status === "string" ? memberData.hierarchy_status : "unassigned",
    firebaseUid: typeof memberData?.firebase_uid === "string" ? memberData.firebase_uid : undefined,
  };
}

/**
 * Shell nav counts — aggregate queries only, no scans.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 */
async function getDashboardSummaryCounts(db, viewer) {
  const normalized = normalizeRole(viewer.roleName);
  const globalScope = PROJECT_SCOPE_ROLES.has(normalized);

  if (globalScope) {
    const [projectRows, taskRows, members, teams] = await Promise.all([
      pgQuery("SELECT COUNT(*)::int AS count FROM projects"),
      pgQuery("SELECT COUNT(*)::int AS count FROM tasks"),
      db.collection("members").count().get(),
      db.collection("teams").count().get(),
    ]);
    return {
      ready: true,
      scoped: false,
      projects: projectRows[0]?.count ?? 0,
      tasks: taskRows[0]?.count ?? 0,
      members: members.data().count,
      teams: teams.data().count,
    };
  }

  const [projectMembershipRows, assignedTaskRows, teamMemberships] = await Promise.all([
    pgQuery("SELECT COUNT(*)::int AS count FROM project_members WHERE member_id = $1", [viewer.memberId]),
    pgQuery("SELECT COUNT(*)::int AS count FROM tasks WHERE assigned_to = $1", [viewer.memberId]),
    db.collection("team_members").where("member_id", "==", viewer.memberId).count().get(),
  ]);

  return {
    ready: true,
    scoped: true,
    projects: projectMembershipRows[0]?.count ?? 0,
    tasks: assignedTaskRows[0]?.count ?? 0,
    members: null,
    teams: teamMemberships.data().count,
  };
}

/**
 * Dashboard shell bootstrap payload (nav, counts, member summary).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ uid: string, memberId: string, roleName: string, email?: string }} viewer
 */
export async function getBootstrapPayload(db, viewer) {
  const gov = await enforcePrivilegedRoleGovernanceForMember(db, viewer.memberId);
  if (!gov.ok) {
    throw Object.assign(new Error(gov.error), { status: gov.status, code: gov.code });
  }

  const roleName = viewer.roleName || (await resolveMemberRoleNameCached(db, viewer.memberId));
  const [memberData, dashboardSummary] = await Promise.all([
    getMemberByIdPg(viewer.memberId),
    getDashboardSummaryCounts(db, { memberId: viewer.memberId, roleName }),
  ]);

  const normalizedRole = normalizeRole(roleName);
  const management = isManagementRole(roleName);

  return {
    user: {
      uid: viewer.uid,
      email: viewer.email ?? memberData?.work_email ?? null,
      displayName:
        memberData?.display_name ||
        [memberData?.first_name, memberData?.last_name].filter(Boolean).join(" ").trim() ||
        null,
      mustChangePassword: memberData?.must_change_password === true,
    },
    member: buildMemberSummary(memberData, viewer.memberId, roleName),
    role: {
      name: roleName,
      normalized: normalizedRole,
      rank: roleRank(roleName),
    },
    permissions: {
      canAccessAllSidebarTabs: canAccessAllSidebarTabs(roleName),
      canManageProjects: management && !hasHierarchyAssignmentRestriction(memberData),
      canManageClients: management && !hasHierarchyAssignmentRestriction(memberData),
      canManageMembers: management && !hasHierarchyAssignmentRestriction(memberData),
      canManageTeams: canCreateTeams(roleName, memberData) && !hasHierarchyAssignmentRestriction(memberData),
      canCreateTransferRequests: canCreateTransferRequests(roleName),
      hierarchyAssignmentRequired: hasHierarchyAssignmentRestriction(memberData),
      canAccessReviewCenter: management || normalizedRole === "client",
      canSeePmTasksSection: roleRank(roleName) >= ROLE_PRIVILEGE_RANK.employeel0,
      canCreateTasks: ORG_TASK_CREATE_ROLES.has(normalizedRole),
      isManagementRole: management,
    },
    workspace: {
      displayName: buildMemberSummary(memberData, viewer.memberId, roleName).name,
      defaultNavItem: defaultNavItemForRole(roleName),
    },
    featureFlags: {
      progressiveDashboard: true,
      backgroundBootstrap: false,
    },
    dashboardSummary,
  };
}
