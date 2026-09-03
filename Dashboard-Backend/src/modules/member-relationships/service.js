import { isEmployeeRole } from "../../http/role-hierarchy.js";
import { canActorManageTargetRole } from "../../http/role-manage-policy.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { sendToMember } from "../presence/index.js";
import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { isOrganizationAdminRole, isOrganizationRootRole } from "../hierarchy/hierarchy-placement.js";
import { normalizeRoleKey } from "../members/services/relation-sync.js";
import {
  deleteMemberTreeCache,
  getMemberTreeCache,
  setMemberTreeCache,
} from "../../lib/postgres/member-data-store.js";
import { query as pgQuery } from "../../lib/postgres/client.js";
import { getMemberByIdPg } from "../../lib/postgres/members-postgres.service.js";
import {
  RelationshipIntegrityError,
  validateNewRelationshipWithRoles,
  planRelationshipRepairs,
} from "./relationship-integrity.js";

export { filterTeamScopeEdges } from "./relationship-integrity.js";



let allRelationshipsCache = null;
let lastLoadTime = 0;
let lastIntegrityRepairAt = 0;
const CACHE_TTL_MS = 2000;
const INTEGRITY_REPAIR_COOLDOWN_MS = 5 * 60 * 1000;
const INTEGRITY_REPAIR_MAX_DELETES = 100;

async function loadRelationshipsFromDb(_db) {
  return pgQuery("SELECT * FROM member_relationships LIMIT 2000");
}

export async function repairMemberRelationshipIntegrity(db, options = {}) {
  const dryRun = options.dryRun === true;
  const maxDeletes = typeof options.maxDeletes === "number" ? options.maxDeletes : INTEGRITY_REPAIR_MAX_DELETES;
  const edges = await loadRelationshipsFromDb(db);
  const plan = planRelationshipRepairs(edges);

  if (!plan.remove.length) {
    return { repaired: false, removed: [], kept: plan.kept.length };
  }

  const pending = plan.remove.slice(0, maxDeletes);
  if (dryRun) {
    return {
      repaired: false,
      dryRun: true,
      removed: pending,
      remaining: Math.max(0, plan.remove.length - pending.length),
      kept: plan.kept.length,
    };
  }

  const affectedMemberIds = new Set();
  for (const item of pending) {
    affectedMemberIds.add(item.edge.parent_member_id);
    affectedMemberIds.add(item.edge.child_member_id);
  }
  await pgQuery("DELETE FROM member_relationships WHERE id = ANY($1::uuid[])", [
    pending.map((item) => item.id),
  ]);

  allRelationshipsCache = null;
  lastLoadTime = 0;

  for (const memberId of affectedMemberIds) {
    await invalidateTreeCache(db, memberId);
  }

  logSafeWarn("[member-relationships-integrity] removed invalid hierarchy edges", {
    removed: pending.length,
    remaining: Math.max(0, plan.remove.length - pending.length),
    reasons: pending.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {}),
  });

  return {
    repaired: true,
    removed: pending,
    remaining: Math.max(0, plan.remove.length - pending.length),
    kept: plan.kept.length,
  };
}

async function maybeRepairRelationshipIntegrity(db, loadedEdges) {
  const plan = planRelationshipRepairs(loadedEdges);
  if (!plan.remove.length) return null;

  const now = Date.now();
  if (now - lastIntegrityRepairAt < INTEGRITY_REPAIR_COOLDOWN_MS) {
    logSafeWarn("[member-relationships-integrity] invalid edges detected; repair skipped during cooldown", {
      invalidCount: plan.remove.length,
    });
    return null;
  }

  lastIntegrityRepairAt = now;
  return repairMemberRelationshipIntegrity(db);
}

async function getAllRelationships(db) {
  const now = Date.now();
  if (allRelationshipsCache && (now - lastLoadTime < CACHE_TTL_MS)) {
    return allRelationshipsCache;
  }
  let rels = await loadRelationshipsFromDb(db);
  const repairResult = await maybeRepairRelationshipIntegrity(db, rels);
  if (repairResult?.repaired) {
    rels = await loadRelationshipsFromDb(db);
  }
  allRelationshipsCache = rels;
  lastLoadTime = Date.now();
  return rels;
}

async function loadValidationEdgesForNewRelationship(_db, parentMemberId, childMemberId) {
  const edges = new Map();

  const addRow = (row) => {
    edges.set(row.id, {
      id: row.id,
      parent_member_id: row.parent_member_id,
      child_member_id: row.child_member_id,
      created_at: row.created_at,
    });
  };

  const [asChildRows, asParentRows] = await Promise.all([
    pgQuery("SELECT * FROM member_relationships WHERE child_member_id = $1 LIMIT 20", [childMemberId]),
    pgQuery("SELECT * FROM member_relationships WHERE parent_member_id = $1 LIMIT 500", [childMemberId]),
  ]);
  for (const row of asChildRows) addRow(row);
  for (const row of asParentRows) addRow(row);

  let frontier = asParentRows
    .map((row) => row.child_member_id)
    .filter((id) => typeof id === "string" && id);
  const seen = new Set([childMemberId, ...frontier]);

  while (frontier.length > 0) {
    const batch = frontier;
    frontier = [];
    const rows = await pgQuery(
      "SELECT * FROM member_relationships WHERE parent_member_id = ANY($1::uuid[])",
      [batch],
    );
    const next = [];
    for (const row of rows) {
      if (!edges.has(row.id)) addRow(row);
      const cid = row.child_member_id;
      if (typeof cid === "string" && cid && !seen.has(cid)) {
        seen.add(cid);
        next.push(cid);
      }
    }
    frontier.push(...next);
  }

  return [...edges.values()];
}

async function loadEdgesForRelationshipValidation(db, parentMemberId, childMemberId, options = {}) {
  if (options.useFullGraph) {
    return getAllRelationships(db);
  }
  return loadValidationEdgesForNewRelationship(db, parentMemberId, childMemberId);
}

export async function recordMemberRelationship(db, {
  parentMemberId,
  childMemberId,
  relationshipType,
  createdBy,
  projects = [],
  useFullGraph = false,
  deferTreeCache = false,
}) {
  const { resolveMemberRoleName } = await import("../activity/activity-scope.js");
  const { isExcludedFromHierarchy } = await import("../hierarchy/hierarchy-placement.js");

  const [childRoleName, parentRoleName] = await Promise.all([
    resolveMemberRoleName(db, childMemberId),
    resolveMemberRoleName(db, parentMemberId),
  ]);

  if (isExcludedFromHierarchy(childRoleName)) {
    throw new RelationshipIntegrityError(
      "EXTERNAL_ENTITY",
      "Clients cannot be placed in the organizational hierarchy. Use project relationships instead.",
    );
  }
  if (isExcludedFromHierarchy(parentRoleName)) {
    throw new RelationshipIntegrityError(
      "EXTERNAL_ENTITY",
      "Clients cannot participate in hierarchy ownership.",
    );
  }

  const existingEdges = await loadEdgesForRelationshipValidation(db, parentMemberId, childMemberId, {
    useFullGraph,
  });
  const validation = validateNewRelationshipWithRoles(
    existingEdges,
    parentMemberId,
    childMemberId,
    normalizeRoleKey(parentRoleName),
    normalizeRoleKey(childRoleName),
  );
  if (!validation.ok) {
    throw new RelationshipIntegrityError(validation.code, validation.message);
  }

  const existingRows = await pgQuery(
    "SELECT * FROM member_relationships WHERE parent_member_id = $1 AND child_member_id = $2 LIMIT 1",
    [parentMemberId, childMemberId],
  );

  if (existingRows.length) {
    const existingData = existingRows[0];
    if (projects.length > 0) {
      const mergedProjects = [...new Set([...(existingData.projects || []), ...projects])];
      if (mergedProjects.length !== (existingData.projects || []).length) {
        await pgQuery("UPDATE member_relationships SET projects = $1 WHERE id = $2", [
          JSON.stringify(mergedProjects),
          existingData.id,
        ]);
        allRelationshipsCache = null;
        return { ...existingData, projects: mergedProjects };
      }
    }
    return existingData;
  }

  const id = crypto.randomUUID();
  const relationship = {
    id,
    parent_member_id: parentMemberId,
    child_member_id: childMemberId,
    relationship_type: relationshipType,
    projects: projects || [],
    created_at: new Date(),
    created_by: createdBy,
  };

  const insertedRows = await pgQuery(
    `INSERT INTO member_relationships (id, parent_member_id, child_member_id, relationship_type, projects, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (parent_member_id, child_member_id) DO NOTHING
     RETURNING *`,
    [id, parentMemberId, childMemberId, relationshipType, JSON.stringify(projects || []), createdBy],
  );
  if (!insertedRows.length) {
    const rows = await pgQuery(
      "SELECT * FROM member_relationships WHERE parent_member_id = $1 AND child_member_id = $2 LIMIT 1",
      [parentMemberId, childMemberId],
    );
    return rows[0];
  }
  allRelationshipsCache = null;

  const refreshTreeCache = async () => {
    await invalidateTreeCache(db, parentMemberId);
    await invalidateTreeCache(db, childMemberId);
    try {
      await updateTreeCache(db, parentMemberId);
      await updateTreeCache(db, childMemberId);
    } catch {
      // Non-fatal background rebuild
    }
  };
  if (deferTreeCache) {
    void refreshTreeCache().catch((err) => {
      logSafeWarn("[member-relationships] deferred tree cache refresh:", err);
    });
  } else {
    await invalidateTreeCache(db, parentMemberId);
    await invalidateTreeCache(db, childMemberId);
  }

  sendToMember(childMemberId, { type: "scope-changed", reason: "hierarchy", at: Date.now() });
  sendToMember(parentMemberId, { type: "scope-changed", reason: "hierarchy", at: Date.now() });

  return relationship;
}

export async function removeMemberParentEdge(db, memberId) {
  const rows = await pgQuery(
    `DELETE FROM member_relationships
     WHERE id IN (SELECT id FROM member_relationships WHERE child_member_id = $1 LIMIT 50)
     RETURNING parent_member_id, child_member_id`,
    [memberId],
  );

  if (!rows.length) return 0;

  const affected = new Set();
  for (const row of rows) {
    if (row.parent_member_id) affected.add(row.parent_member_id);
    if (row.child_member_id) affected.add(row.child_member_id);
  }

  allRelationshipsCache = null;
  lastLoadTime = 0;

  for (const id of affected) {
    await invalidateTreeCache(db, id);
  }

  return rows.length;
}

export async function removeMemberHierarchyRelationships(db, memberId) {
  const rows = await pgQuery(
    `DELETE FROM member_relationships
     WHERE id IN (
       SELECT id FROM member_relationships WHERE child_member_id = $1 LIMIT 50
       UNION
       SELECT id FROM member_relationships WHERE parent_member_id = $1 LIMIT 50
     )
     RETURNING parent_member_id, child_member_id`,
    [memberId],
  );

  if (!rows.length) return 0;

  const affected = new Set();
  for (const row of rows) {
    if (row.parent_member_id) affected.add(row.parent_member_id);
    if (row.child_member_id) affected.add(row.child_member_id);
  }

  allRelationshipsCache = null;
  lastLoadTime = 0;
  for (const id of affected) {
    await invalidateTreeCache(db, id);
  }

  return rows.length;
}

export async function resolveAvatarUrlsForMembers(db, membersInput) {
  const avatarByMemberId = new Map();
  const uidByMemberId = new Map();

  const items = Array.isArray(membersInput)
    ? membersInput
    : (membersInput && Array.isArray(membersInput.docs) ? membersInput.docs : []);

  for (const item of items) {
    if (!item) continue;
    const id = item.id ? String(item.id) : "";
    const data = typeof item.data === "function" ? item.data() : item;
    const uid = data?.firebase_uid;
    if (id && typeof uid === "string" && uid.trim()) {
      uidByMemberId.set(id, uid.trim());
    }
  }

  const uids = [...new Set(uidByMemberId.values())];
  if (!uids.length) return avatarByMemberId;

  const { USER_PROFILES_COLLECTION } = await import("../auth/profile-collection-name.js");
  const { resolveProfileAvatarUrl } = await import("../auth/profile-image-resolve.js");
  const refs = uids.map((uid) => db.collection(USER_PROFILES_COLLECTION).doc(uid));
  const profileSnaps = await db.getAll(...refs);

  const avatarByUid = new Map();
  for (const snap of profileSnaps) {
    if (!snap.exists) continue;
    const url = resolveProfileAvatarUrl(snap.data());
    if (url) avatarByUid.set(snap.id, url);
  }

  for (const [memberId, uid] of uidByMemberId) {
    const url = avatarByUid.get(uid);
    if (url) avatarByMemberId.set(memberId, url);
  }

  return avatarByMemberId;
}

export async function getMemberParentId(db, memberId) {
  const rels = await getAllRelationships(db);
  for (const rel of rels) {
    if (rel.child_member_id === memberId) {
      return rel.parent_member_id;
    }
  }
  return null;
}

export async function getMemberAncestors(db, memberId) {
  const cache = await getCachedTreeData(db, memberId);
  if (cache?.ancestors) {
    return cache.ancestors;
  }

  const rels = await getAllRelationships(db);
  const childToParent = new Map();
  for (const rel of rels) {
    childToParent.set(rel.child_member_id, {
      parent_id: rel.parent_member_id,
      relationship_type: rel.relationship_type,
    });
  }

  const ancestors = [];
  let currentId = memberId;
  let level = 0;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = childToParent.get(currentId);
    if (!parent) break;
    currentId = parent.parent_id;
    level++;

    ancestors.push({
      member_id: currentId,
      level,
      relationship_type: parent.relationship_type,
    });
  }

  return ancestors.reverse();
}

export async function getMemberDescendants(db, memberId, maxDepth = 10) {
  const cache = await getCachedTreeData(db, memberId);
  if (cache?.descendants) {
    return cache.descendants;
  }

  const rels = await getAllRelationships(db);
  const parentToChildren = new Map();
  for (const rel of rels) {
    if (!parentToChildren.has(rel.parent_member_id)) {
      parentToChildren.set(rel.parent_member_id, []);
    }
    parentToChildren.get(rel.parent_member_id).push(rel);
  }

  const descendants = [];
  const queue = [{ id: memberId, level: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const { id, level } = queue.shift();

    if (level >= maxDepth || visited.has(id)) continue;
    visited.add(id);

    const children = parentToChildren.get(id) || [];
    for (const rel of children) {
      if (!visited.has(rel.child_member_id)) {
        descendants.push({
          member_id: rel.child_member_id,
          level: level + 1,
          relationship_type: rel.relationship_type,
        });
        queue.push({ id: rel.child_member_id, level: level + 1 });
      }
    }
  }

  return descendants;
}

export async function getMemberTreePath(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  const path = ancestors.map(a => a.member_id);
  path.push(memberId);
  return path;
}

export async function isAncestorOf(db, potentialAncestorId, memberId) {
  const path = await getMemberTreePath(db, memberId);
  return path.includes(potentialAncestorId);
}

export async function getMemberRoot(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  return ancestors.length > 0 ? ancestors[0].member_id : memberId;
}

export async function getConnectedMembers(db, memberId) {
  const rootId = await getMemberRoot(db, memberId);
  const descendants = await getMemberDescendants(db, rootId);
  const members = [rootId, ...descendants.map(d => d.member_id)];

  return {
    root_id: rootId,
    members: [...new Set(members)], // Deduplicate
  };
}

export async function getMembersBySharedProjects(db, memberId) {
  if (!memberId) return [];
  const rows = await pgQuery(
    `WITH mine AS (
       SELECT project_id FROM project_members WHERE member_id = $1
       UNION
       SELECT cp.project_id
       FROM client_projects cp
       JOIN clients c ON c.id = cp.client_id
       WHERE c.member_id = $1
     )
     SELECT DISTINCT pm.member_id
     FROM project_members pm
     WHERE pm.project_id IN (SELECT project_id FROM mine) AND pm.member_id != $1`,
    [memberId],
  );
  return rows.map((r) => r.member_id).filter(Boolean);
}

export async function getVisibleMembersForClient(db, memberId) {
  const projectMembers = await getMembersBySharedProjects(db, memberId);
  const allVisible = [...new Set([memberId, ...projectMembers])];

  return {
    root_id: null,
    tree_members: [],
    project_members: projectMembers,
    all_visible: allVisible,
  };
}

async function resolveSharedOrgOwnerMemberId(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  for (const ancestor of ancestors) {
    const roleName = await resolveMemberRoleName(db, ancestor.member_id);
    if (isOrganizationRootRole(roleName)) return ancestor.member_id;
  }
  const selfRole = await resolveMemberRoleName(db, memberId);
  if (isOrganizationRootRole(selfRole)) return memberId;
  return null;
}

function isUplineOrgAdminRole(roleName) {
  return isOrganizationRootRole(roleName) || isOrganizationAdminRole(roleName);
}

function isOrgLeadershipRole(roleName) {
  const key = normalizeRoleKey(roleName);
  return (
    isOrganizationRootRole(roleName) ||
    isOrganizationAdminRole(roleName) ||
    key === "supermanager" ||
    key === "supermanger" ||
    key === "manager"
  );
}

async function getOrgLeadershipReadOnlyMemberIds(db, viewerMemberId) {
  const ownerMemberId = await resolveSharedOrgOwnerMemberId(db, viewerMemberId);
  if (!ownerMemberId) return [];

  if (!(await memberBelongsToOrg(db, viewerMemberId, ownerMemberId))) return [];

  const ids = new Set();
  const { adminMemberIds } = await collectOrgAdminCreators(db, ownerMemberId);
  for (const id of adminMemberIds) ids.add(id);

  const descendants = await getMemberDescendants(db, ownerMemberId, 100);
  for (const node of descendants) {
    const roleName = await resolveMemberRoleName(db, node.member_id);
    if (isOrgLeadershipRole(roleName)) ids.add(node.member_id);
  }

  return [...ids];
}

async function memberBelongsToOrg(db, memberId, ownerMemberId) {
  if (memberId === ownerMemberId) return true;
  const ancestors = await getMemberAncestors(db, memberId);
  if (ancestors.some((ancestor) => ancestor.member_id === ownerMemberId)) return true;

  const data = (await getMemberByIdPg(memberId)) || {};
  if (data.created_by === ownerMemberId) return true;

  const ownerData = (await getMemberByIdPg(ownerMemberId)) || {};
  const ownerUid = String(ownerData.firebase_uid || "").trim();
  const createdByUid = String(data.created_by_uid || "").trim();
  return Boolean(ownerUid && createdByUid === ownerUid);
}

async function collectOrgAdminCreators(db, ownerMemberId) {
  const adminMemberIds = new Set([ownerMemberId]);
  const adminFirebaseUids = new Set();

  const ownerData = await getMemberByIdPg(ownerMemberId);
  if (ownerData && ownerData.firebase_uid) {
    adminFirebaseUids.add(String(ownerData.firebase_uid).trim());
  }

  const descendants = await getMemberDescendants(db, ownerMemberId, 100);
  for (const node of descendants) {
    const roleName = await resolveMemberRoleName(db, node.member_id);
    if (!isUplineOrgAdminRole(roleName)) continue;
    adminMemberIds.add(node.member_id);
    const mData = await getMemberByIdPg(node.member_id);
    if (mData && mData.firebase_uid) {
      adminFirebaseUids.add(String(mData.firebase_uid).trim());
    }
  }

  return { adminMemberIds, adminFirebaseUids };
}

async function getOrgUplineAddedMemberIds(db, viewerMemberId) {
  const ownerMemberId = await resolveSharedOrgOwnerMemberId(db, viewerMemberId);
  if (!ownerMemberId) return [];

  const viewerInOrg = await memberBelongsToOrg(db, viewerMemberId, ownerMemberId);
  if (!viewerInOrg) return [];

  const { adminMemberIds, adminFirebaseUids } = await collectOrgAdminCreators(db, ownerMemberId);
  const candidateIds = new Set();

  for (const uid of adminFirebaseUids) {
    try {
      const rows = await pgQuery(
        "SELECT id FROM members WHERE created_by_uid = $1 LIMIT 500",
        [uid],
      );
      for (const row of rows) if (row.id) candidateIds.add(row.id);
    } catch (err) {
      logSafeWarn("[getOrgUplineAddedMemberIds] created_by_uid lookup failed:", err);
    }
  }

  for (const adminId of adminMemberIds) {
    try {
      const rows = await pgQuery(
        "SELECT id FROM members WHERE created_by = $1 LIMIT 500",
        [adminId],
      );
      for (const row of rows) if (row.id) candidateIds.add(row.id);
    } catch (err) {
      logSafeWarn("[getOrgUplineAddedMemberIds] created_by lookup failed:", err);
    }
  }

  const visible = [];
  for (const id of candidateIds) {
    if (!(await memberBelongsToOrg(db, id, ownerMemberId))) continue;
    const roleName = await resolveMemberRoleName(db, id);
    if (isUplineOrgAdminRole(roleName)) continue;
    visible.push(id);
  }
  return visible;
}

export async function getTeamSubtreeMemberIds(db, memberId, maxDepth = 100) {
  const ids = new Set([memberId]);
  const descendants = await getMemberDescendants(db, memberId, maxDepth);
  for (const d of descendants) {
    ids.add(d.member_id);
  }

  const memberData = await getMemberByIdPg(memberId);
  const firebaseUid = memberData && typeof memberData.firebase_uid === "string"
    ? memberData.firebase_uid.trim()
    : "";
  if (firebaseUid) {
    try {
      const addedRows = await pgQuery(
        "SELECT id FROM members WHERE created_by_uid = $1 LIMIT 500",
        [firebaseUid],
      );
      for (const row of addedRows) {
        if (!row.id) continue;
        ids.add(row.id);
        const nested = await getMemberDescendants(db, row.id, maxDepth);
        for (const d of nested) ids.add(d.member_id);
      }
    } catch (err) {
      logSafeWarn("[getTeamSubtreeMemberIds] created_by_uid lookup failed:", err);
    }
  }

  return [...ids];
}

async function getSubtreeUplineReadOnlyMemberIds(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  return ancestors.map((ancestor) => ancestor.member_id);
}

export async function getManagerVisibleMemberIds(db, memberId) {
  const [subtree, uplineAdded] = await Promise.all([
    getTeamSubtreeMemberIds(db, memberId),
    getOrgUplineAddedMemberIds(db, memberId),
  ]);
  return [...new Set([...subtree, ...uplineAdded])];
}

export async function getManagerPeoplePageVisibleMemberIds(db, memberId) {
  const [manageable, uplineReadOnly, orgLeadership] = await Promise.all([
    getManagerVisibleMemberIds(db, memberId),
    getSubtreeUplineReadOnlyMemberIds(db, memberId),
    getOrgLeadershipReadOnlyMemberIds(db, memberId),
  ]);
  return [...new Set([...manageable, ...uplineReadOnly, ...orgLeadership])];
}

async function filterManageableMemberIdsByRole(db, actorRoleName, memberIds) {
  const manageable = [];
  for (const id of memberIds) {
    const roleName = await resolveMemberRoleName(db, id);
    if (canActorManageTargetRole(actorRoleName, roleName)) manageable.push(id);
  }
  return manageable;
}

export async function getManageableMemberIds(db, memberId, roleName) {
  if (!roleName) return [memberId];
  const role = roleName.trim().toLowerCase().replace(/\s+/g, "");

  if (["superadmin", "owner", "admin"].includes(role)) {
    return null;
  }

  if (role === "supermanager" || role === "supermanger" || role === "manager") {
    const scoped = await getManagerVisibleMemberIds(db, memberId);
    return filterManageableMemberIdsByRole(db, roleName, scoped);
  }

  if (isEmployeeRole(roleName)) {
    return [memberId];
  }

  if (role === "client") {
    return [memberId];
  }

  return [memberId];
}

async function getOwnerOrgMemberIds(db, ownerMemberId) {
  const ids = new Set([ownerMemberId]);
  const descendants = await getMemberDescendants(db, ownerMemberId, 100);
  for (const d of descendants) ids.add(d.member_id);
  return [...ids];
}

async function filterOutViewerRole(db, memberIds) {
  const kept = [];
  for (const id of memberIds) {
    const roleName = await resolveMemberRoleName(db, id);
    if (normalizeRoleKey(roleName) !== "viewer") kept.push(id);
  }
  return kept;
}

export async function getEmployeeHierarchyMemberIds(db, memberId) {
  const ownerMemberId = await resolveSharedOrgOwnerMemberId(db, memberId);
  if (ownerMemberId && (await memberBelongsToOrg(db, memberId, ownerMemberId))) {
    const ids = await getOwnerOrgMemberIds(db, ownerMemberId);
    return filterOutViewerRole(db, ids);
  }

  const ancestors = await getMemberAncestors(db, memberId);
  const directParentId =
    ancestors.length > 0 ? ancestors[ancestors.length - 1].member_id : null;
  const ids = directParentId
    ? await getTeamSubtreeMemberIds(db, directParentId)
    : await getTeamSubtreeMemberIds(db, memberId);
  return filterOutViewerRole(db, ids);
}

export async function getVisibleMemberIds(db, memberId, roleName) {
  if (!roleName) return [memberId];
  const role = roleName.trim().toLowerCase().replace(/\s+/g, "");
  
  if (["superadmin", "owner", "admin"].includes(role)) {
    return null;
  }
  
  if (role === "supermanager" || role === "supermanger" || role === "manager") {
    return getManagerPeoplePageVisibleMemberIds(db, memberId);
  }

  if (isEmployeeRole(roleName)) {
    return getEmployeeHierarchyMemberIds(db, memberId);
  }
  
  if (role === "client") {
    const visibility = await getVisibleMembersForClient(db, memberId);
    return visibility.all_visible;
  }
  
  return [memberId];
}

export async function buildMemberTree(db, rootMemberId) {
  const descendants = await getMemberDescendants(db, rootMemberId);

  const children = new Map();
  children.set(rootMemberId, []);

  for (const desc of descendants) {
    if (!children.has(desc.member_id)) {
      children.set(desc.member_id, []);
    }
  }

  const rels = await getAllRelationships(db);
  for (const rel of rels) {
    if (children.has(rel.parent_member_id)) {
      children.get(rel.parent_member_id).push({
        member_id: rel.child_member_id,
        relationship_type: rel.relationship_type,
      });
    }
  }

  function buildNode(memberId) {
    const nodeChildren = children.get(memberId) || [];
    return {
      member_id: memberId,
      children: nodeChildren.map(child => ({
        ...child,
        ...buildNode(child.member_id),
      })),
    };
  }

  return buildNode(rootMemberId);
}


async function getCachedTreeData(db, memberId) {
  return getMemberTreeCache(db, memberId);
}

async function invalidateTreeCache(db, memberId) {
  await deleteMemberTreeCache(db, memberId);
}

export async function updateTreeCache(db, memberId) {
  const [ancestors, descendants] = await Promise.all([
    getMemberAncestors(db, memberId),
    getMemberDescendants(db, memberId),
  ]);

  const rootId = ancestors.length > 0 ? ancestors[0].member_id : memberId;
  const depth = ancestors.length;

  await setMemberTreeCache(db, memberId, {
    id: memberId,
    ancestors,
    descendants,
    root_id: rootId,
    depth,
    updated_at: new Date(),
  });
}

export function resetMemberRelationshipsCacheForTests() {
  allRelationshipsCache = null;
  lastLoadTime = 0;
  lastIntegrityRepairAt = 0;
}
