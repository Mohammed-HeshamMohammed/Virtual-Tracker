import { getVisibleMemberIds } from "../member-relationships/service.js";
import { pickHighestPrivilegeRoleName, resolveRoleNameById } from "../members/services/relation-sync.js";

const PRIVILEGED_ROLES = new Set(["owner", "superadmin", "admin"]);
const PROJECT_SCOPE_ROLES = new Set(["owner", "superadmin", "admin"]);

function normalizeRole(roleName) {
  return String(roleName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export async function resolveMemberRoleName(db, memberId) {
  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) return "Viewer";
  const memberRoleId = typeof memberSnap.data()?.role_id === "string" ? memberSnap.data().role_id : "";
  if (!memberRoleId) return "Viewer";
  const roleName = await resolveRoleNameById(db, memberRoleId);
  return pickHighestPrivilegeRoleName([roleName || "Viewer"]);
}

/** Member IDs on projects the viewer belongs to (via project_members + members.projects). */
export async function getProjectScopedMemberIds(db, viewerMemberId) {
  const ids = new Set([viewerMemberId]);
  const projectIds = new Set();

  const pmSnap = await db
    .collection("project_members")
    .where("member_id", "==", viewerMemberId)
    .limit(200)
    .get();
  for (const doc of pmSnap.docs) {
    const pid = doc.data()?.project_id;
    if (pid) projectIds.add(pid);
  }

  const memberDoc = await db.collection("members").doc(viewerMemberId).get();
  const memberProjects = memberDoc.exists ? memberDoc.data()?.projects || [] : [];
  for (const pid of memberProjects) {
    if (pid) projectIds.add(pid);
  }

  const projectIdList = [...projectIds];
  const CHUNK = 30;
  for (let i = 0; i < projectIdList.length; i += CHUNK) {
    const chunk = projectIdList.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    const teamSnap = await db
      .collection("project_members")
      .where("project_id", "in", chunk)
      .limit(200 * chunk.length)
      .get();
    for (const doc of teamSnap.docs) {
      const mid = doc.data()?.member_id;
      if (mid) ids.add(mid);
    }
  }

  return ids;
}

function memberMetaFromDoc(doc) {
  const d = doc.data() || {};
  const first =
    (typeof d.first_name === "string" && d.first_name) ||
    (typeof d.firstName === "string" && d.firstName) ||
    "";
  const last =
    (typeof d.last_name === "string" && d.last_name) ||
    (typeof d.lastName === "string" && d.lastName) ||
    "";
  const name = `${first} ${last}`.trim() || (typeof d.name === "string" ? d.name : "") || "Unknown";
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  return { name, initials };
}

const MEMBER_META_SELECT = ["first_name", "firstName", "last_name", "lastName", "name"];

export async function buildMemberMetaMap(db, allowedIds) {
  const meta = new Map();
  if (allowedIds === null) {
    const snap = await db.collection("members").select(...MEMBER_META_SELECT).limit(400).get();
    for (const doc of snap.docs) {
      meta.set(doc.id, memberMetaFromDoc(doc));
    }
    return meta;
  }

  if (allowedIds.length === 0) return meta;

  for (let i = 0; i < allowedIds.length; i += 10) {
    const chunk = allowedIds.slice(i, i + 10);
    const refs = chunk.map((id) => db.collection("members").doc(id));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      meta.set(doc.id, memberMetaFromDoc(doc));
    }
  }
  return meta;
}

/** Allowed member IDs for activity feed + optional memberId filter check. */
export async function resolveActivityFeedScope(db, viewerMemberId, options = {}) {
  const memberIdFilter = String(options.memberId || "").trim();
  const projectScopeOnly = options.projectScopeOnly === true || options.projectScopeOnly === "true";

  const roleName = await resolveMemberRoleName(db, viewerMemberId);
  const roleKey = normalizeRole(roleName);

  let allowedMemberIds = await getVisibleMemberIds(db, viewerMemberId, roleName);
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
