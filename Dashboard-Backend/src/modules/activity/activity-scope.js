import { getVisibleMemberIds } from "../member-relationships/service.js";
import { pickHighestPrivilegeRoleName, resolveRoleNameById } from "../members/services/relation-sync.js";
import { listMemberIdsForProjectsPg, listViewerProjectIdsPg } from "../../lib/postgres/projects-postgres.service.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";

import { getMemberByIdPg, getMembersByIdsPg, listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { normalizeRoleKey } from "../../http/role-key.js";

const PRIVILEGED_ROLES = new Set(["owner", "superadmin", "admin"]);
const PROJECT_SCOPE_ROLES = new Set(["owner", "superadmin", "admin"]);

function normalizeRole(roleName) {
  return normalizeRoleKey(roleName);
}

export async function resolveMemberRoleName(db, memberId) {
  if (!memberId) return "Viewer";
  const memberData = await getMemberByIdPg(memberId);
  if (!memberData) return "Viewer";
  const memberRoleId = typeof memberData.role_id === "string" ? memberData.role_id : "";
  if (!memberRoleId) return "Viewer";
  const roleName = await resolveRoleNameById(db, memberRoleId);
  return pickHighestPrivilegeRoleName([roleName || "Viewer"]);
}

export async function getProjectScopedMemberIds(db, viewerMemberId) {
  const ids = new Set([viewerMemberId]);
  const projectIds = new Set(await listViewerProjectIdsPg(viewerMemberId));

  for (const mid of await listMemberIdsForProjectsPg([...projectIds])) {
    if (mid) ids.add(mid);
  }

  return ids;
}

function memberMetaFromRow(row) {
  if (!row) return { name: "Unknown", initials: "??" };
  const first =
    (typeof row.first_name === "string" && row.first_name) ||
    (typeof row.firstName === "string" && row.firstName) ||
    "";
  const last =
    (typeof row.last_name === "string" && row.last_name) ||
    (typeof row.lastName === "string" && row.lastName) ||
    "";
  const name = (typeof row.display_name === "string" && row.display_name.trim()) || `${first} ${last}`.trim() || (typeof row.name === "string" ? row.name : "") || "Unknown";
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  return { name, initials };
}

export async function buildMemberMetaMap(db, allowedIds) {
  const meta = new Map();
  if (allowedIds === null) {
    const memberRows = await listMembersPg({ limit: 5000 });
    for (const row of memberRows) {
      if (row.id) meta.set(String(row.id), memberMetaFromRow(row));
    }
    return meta;
  }

  if (allowedIds.length === 0) return meta;

  const memberRows = await getMembersByIdsPg(allowedIds);
  for (const row of memberRows) {
    if (row && row.id) {
      meta.set(row.id, memberMetaFromRow(row));
    }
  }
  return meta;
}

export async function resolveActivityFeedScope(db, viewerMemberId, options = {}) {
  const memberIdFilter = String(options.memberId || "").trim();
  const projectScopeOnly = options.projectScopeOnly === true || options.projectScopeOnly === "true";

  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);

  let allowedMemberIds = isEmployeeRole(roleName)
    ? [viewerMemberId]
    : await getVisibleMemberIds(db, viewerMemberId, roleName);
  const canFilterByProject = PROJECT_SCOPE_ROLES.has(roleKey);

  if (projectScopeOnly && canFilterByProject) {
    const projectScoped = await getProjectScopedMemberIds(db, viewerMemberId);
    if (allowedMemberIds === null) {
      allowedMemberIds = [...projectScoped];
    } else {
      allowedMemberIds = allowedMemberIds.filter((id) => projectScoped.has(id));
    }
  }

  if (allowedMemberIds !== null) {
    const set = new Set(allowedMemberIds);
    if (!set.has(viewerMemberId)) set.add(viewerMemberId);
    allowedMemberIds = [...set];
  }

  let targetMemberIds = null;
  if (!memberIdFilter || memberIdFilter === "all") {
    targetMemberIds = allowedMemberIds;
  } else {
    if (allowedMemberIds !== null && !allowedMemberIds.includes(memberIdFilter)) {
      return { forbidden: true, roleName, canFilterByProject, allowedMemberIds, targetMemberIds: [] };
    }
    targetMemberIds = [memberIdFilter];
  }

  return {
    forbidden: false,
    roleName,
    canFilterByProject,
    canSeeAllMembers: allowedMemberIds === null || (allowedMemberIds?.length ?? 0) > 1,
    allowedMemberIds,
    targetMemberIds,
    projectScopeOnly: projectScopeOnly && canFilterByProject,
  };
}


export function memberOptionsFromMeta(allowedMemberIds, memberMeta, viewerMemberId) {
  if (allowedMemberIds === null) {
    return [...memberMeta.entries()]
      .map(([id, m]) => ({ id, name: m.name, initials: m.initials }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return allowedMemberIds
    .map((id) => {
      const m = memberMeta.get(id) || { name: "Unknown", initials: "??" };
      return { id, name: m.name, initials: m.initials };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
