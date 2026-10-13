import { getVisibleMemberIds } from "../member-relationships/service.js";
import { pickHighestPrivilegeRoleName, resolveRoleNameById } from "../members/services/relation-sync.js";
import { listMemberIdsForProjectsPg, listViewerProjectIdsPg } from "../../lib/postgres/projects-postgres.service.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";

import { getMemberByIdPg, getMembersByIdsPg, listMembersPg } from "../../lib/postgres/members-postgres.service.js";
import { normalizeRoleKey } from "../../http/role-key.js";
import { loadMemberPhotoUrls } from "../members/services/member-photo-urls.js";

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
  if (!row) return { name: "Unknown", initials: "??", avatarUrl: null };
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
  // row comes from `SELECT *` (getMembersByIdsPg/listMembersPg), so
  // avatar_url is already on it - every report that reads this map (every
  // one of them routes member names through buildMemberMetaMap) can now
  // carry a real profile photo alongside the name it already had, instead
  // of only ever rendering initials.
  const avatarUrl = (typeof row.avatar_url === "string" && row.avatar_url.trim()) || null;
  return { name, initials, avatarUrl };
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

/** A person's photo lives on their profile; `members.avatar_url` is only a copy
 *  that is often still empty. Past this many people the photos are skipped
 *  rather than fetched - a picker of hundreds shows initials. */
const MAX_PHOTO_LOOKUPS = 200;

/**
 * Profile photos for the members in a meta map, keyed by id, so a feed row can
 * show the same picture the rest of the app does. Cosmetic: a failed lookup
 * leaves the map exactly as it was and the avatar falls back to initials.
 */
export async function withMemberPhotos(db, meta) {
  const ids = [...meta.keys()].slice(0, MAX_PHOTO_LOOKUPS);
  if (ids.length === 0) return meta;
  try {
    const photos = await loadMemberPhotoUrls(db, await getMembersByIdsPg(ids));
    for (const [id, url] of photos) {
      const entry = meta.get(id);
      if (entry) meta.set(id, { ...entry, avatarUrl: url });
    }
  } catch {
    // initials it is
  }
  return meta;
}

export async function buildMemberMetaMapWithPhotos(db, allowedIds) {
  return withMemberPhotos(db, await buildMemberMetaMap(db, allowedIds));
}

/** `all`, or one id, or several joined by commas - every one of them must be
 *  somebody the viewer may see. */
export function parseMemberIdFilter(value) {
  const ids = [...new Set(String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean))].slice(0, 200);
  return ids.length === 0 || ids.includes("all") ? [] : ids;
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
  const requestedMemberIds = parseMemberIdFilter(memberIdFilter);
  if (requestedMemberIds.length === 0) {
    targetMemberIds = allowedMemberIds;
  } else {
    if (allowedMemberIds !== null && requestedMemberIds.some((id) => !allowedMemberIds.includes(id))) {
      return { forbidden: true, roleName, canFilterByProject, allowedMemberIds, targetMemberIds: [] };
    }
    targetMemberIds = requestedMemberIds;
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
      .map(([id, m]) => ({ id, name: m.name, initials: m.initials, avatarUrl: m.avatarUrl ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return allowedMemberIds
    .map((id) => {
      const m = memberMeta.get(id) || { name: "Unknown", initials: "??" };
      return { id, name: m.name, initials: m.initials, avatarUrl: m.avatarUrl ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
