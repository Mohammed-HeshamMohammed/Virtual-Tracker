import { FieldValue } from "firebase-admin/firestore";
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
import {
  filterTeamScopeEdges,
  planRelationshipRepairs,
  RelationshipIntegrityError,
  validateNewRelationshipWithRoles,
} from "./relationship-integrity.js";

export { filterTeamScopeEdges } from "./relationship-integrity.js";

/**
 * @typedef {Object} MemberRelationship
 * @property {string} id
 * @property {string} parent_member_id
 * @property {string} child_member_id
 * @property {string} relationship_type
 * @property {Date} created_at
 * @property {string} created_by
 */

/**
 * @typedef {Object} TreeNode
 * @property {string} member_id
 * @property {number} level
 * @property {string} relationship_type
 */

let allRelationshipsCache = null;
let lastLoadTime = 0;
let lastIntegrityRepairAt = 0;
const CACHE_TTL_MS = 2000;
const INTEGRITY_REPAIR_COOLDOWN_MS = 5 * 60 * 1000;
const INTEGRITY_REPAIR_MAX_DELETES = 100;

async function loadRelationshipsFromDb(db) {
  const snap = await db.collection("member_relationships").limit(2000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Drop bad hierarchy edges; only writes when something needs fixing.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ dryRun?: boolean, maxDeletes?: number }} [options]
 */
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

  const batch = db.batch();
  const affectedMemberIds = new Set();
  for (const item of pending) {
    batch.delete(db.collection("member_relationships").doc(item.id));
    affectedMemberIds.add(item.edge.parent_member_id);
    affectedMemberIds.add(item.edge.child_member_id);
  }
  await batch.commit();

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

/**
 * Subgraph fetch for validating a new parent→child edge.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} parentMemberId
 * @param {string} childMemberId
 */
async function loadValidationEdgesForNewRelationship(db, parentMemberId, childMemberId) {
  /** @type {Map<string, { id: string, parent_member_id: string, child_member_id: string, created_at?: unknown }>} */
  const edges = new Map();

  /** @param {import("firebase-admin/firestore").QueryDocumentSnapshot} doc */
  const addDoc = (doc) => {
    const data = doc.data() || {};
    edges.set(doc.id, {
      id: doc.id,
      parent_member_id: data.parent_member_id,
      child_member_id: data.child_member_id,
      created_at: data.created_at,
    });
  };

  const [asChildSnap, asParentSnap] = await Promise.all([
    db.collection("member_relationships").where("child_member_id", "==", childMemberId).limit(20).get(),
    db.collection("member_relationships").where("parent_member_id", "==", childMemberId).limit(500).get(),
  ]);
  for (const doc of asChildSnap.docs) addDoc(doc);
  for (const doc of asParentSnap.docs) addDoc(doc);

  /** @type {string[]} */
  let frontier = asParentSnap.docs
    .map((doc) => doc.data()?.child_member_id)
    .filter((id) => typeof id === "string" && id);
  const seen = new Set([childMemberId, ...frontier]);

  while (frontier.length > 0) {
    const batch = frontier.slice(0, 10);
    frontier = frontier.slice(10);
    const snap = await db.collection("member_relationships").where("parent_member_id", "in", batch).get();
    /** @type {string[]} */
    const next = [];
    for (const doc of snap.docs) {
      if (!edges.has(doc.id)) addDoc(doc);
      const cid = doc.data()?.child_member_id;
      if (typeof cid === "string" && cid && !seen.has(cid)) {
        seen.add(cid);
        next.push(cid);
      }
    }
    frontier.push(...next);
  }

  return [...edges.values()];
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} parentMemberId
 * @param {string} childMemberId
 * @param {{ useFullGraph?: boolean }} [options]
 */
async function loadEdgesForRelationshipValidation(db, parentMemberId, childMemberId, options = {}) {
  if (options.useFullGraph) {
    return getAllRelationships(db);
  }
  return loadValidationEdgesForNewRelationship(db, parentMemberId, childMemberId);
}

/**
 * Record who added whom.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Object} params
 * @param {string} params.parentMemberId - The member who did the adding
 * @param {string} params.childMemberId - The member who was added
 * @param {string} params.relationshipType - "invite", "preprovision", "self_signup", "admin_create"
 * @param {string} params.createdBy - Who recorded this
 * @returns {Promise<MemberRelationship>}
 */
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

  // Check if relationship already exists
  const existing = await db.collection("member_relationships")
    .where("parent_member_id", "==", parentMemberId)
    .where("child_member_id", "==", childMemberId)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    const existingData = doc.data();
    // Update projects if provided and different
    if (projects.length > 0) {
      const mergedProjects = [...new Set([...(existingData.projects || []), ...projects])];
      if (mergedProjects.length !== (existingData.projects || []).length) {
        await db.collection("member_relationships").doc(doc.id).update({
          projects: mergedProjects,
        });
        allRelationshipsCache = null; // Clear cache on update
        return { id: doc.id, ...existingData, projects: mergedProjects };
      }
    }
    return { id: doc.id, ...existingData };
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

  await db.collection("member_relationships").doc(id).set(relationship);
  allRelationshipsCache = null; // Clear cache on insert

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
    // invalidateTreeCache sits outside refreshTreeCache's inner try, so this
    // needs its own catch.
    void refreshTreeCache().catch((err) => {
      logSafeWarn("[member-relationships] deferred tree cache refresh:", err);
    });
  } else {
    await invalidateTreeCache(db, parentMemberId);
    await invalidateTreeCache(db, childMemberId);
  }

  // §6.3 - a manager/hierarchy change is scoped to the two members whose
  // tree position moved, not broadcast: it can reveal org structure to
  // members outside it.
  sendToMember(childMemberId, { type: "scope-changed", reason: "hierarchy", at: Date.now() });
  sendToMember(parentMemberId, { type: "scope-changed", reason: "hierarchy", at: Date.now() });

  return relationship;
}

/**
 * Remove this member's parent edge only (keep edges where they're the parent).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<number>} edges removed
 */
export async function removeMemberParentEdge(db, memberId) {
  const asChildSnap = await db
    .collection("member_relationships")
    .where("child_member_id", "==", memberId)
    .limit(50)
    .get();

  if (asChildSnap.empty) return 0;

  const batch = db.batch();
  const affected = new Set();
  for (const doc of asChildSnap.docs) {
    batch.delete(doc.ref);
    const d = doc.data() || {};
    if (d.parent_member_id) affected.add(d.parent_member_id);
    if (d.child_member_id) affected.add(d.child_member_id);
  }
  await batch.commit();

  allRelationshipsCache = null;
  lastLoadTime = 0;

  for (const id of affected) {
    await invalidateTreeCache(db, id);
  }

  return asChildSnap.size;
}

/** Strip all hierarchy edges for a member (Client conversion, org exit). */
export async function removeMemberHierarchyRelationships(db, memberId) {
  const [asChildSnap, asParentSnap] = await Promise.all([
    db.collection("member_relationships").where("child_member_id", "==", memberId).limit(50).get(),
    db.collection("member_relationships").where("parent_member_id", "==", memberId).limit(50).get(),
  ]);

  const refs = [...asChildSnap.docs, ...asParentSnap.docs];
  if (!refs.length) return 0;

  const batch = db.batch();
  const affected = new Set();
  for (const doc of refs) {
    batch.delete(doc.ref);
    const d = doc.data() || {};
    if (d.parent_member_id) affected.add(d.parent_member_id);
    if (d.child_member_id) affected.add(d.child_member_id);
  }
  await batch.commit();

  allRelationshipsCache = null;
  lastLoadTime = 0;
  for (const id of affected) {
    await invalidateTreeCache(db, id);
  }

  return refs.length;
}

/**
 * Avatar URLs for tree nodes (batched getAll per uid).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/firestore").QuerySnapshot} membersSnap
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveAvatarUrlsForMembers(db, membersSnap) {
  /** @type {Map<string, string>} */
  const avatarByMemberId = new Map();
  /** @type {Map<string, string>} */
  const uidByMemberId = new Map();

  for (const doc of membersSnap.docs) {
    const uid = doc.data()?.firebase_uid;
    if (typeof uid === "string" && uid.trim()) {
      uidByMemberId.set(doc.id, uid.trim());
    }
  }

  const uids = [...new Set(uidByMemberId.values())];
  if (!uids.length) return avatarByMemberId;

  const { USER_PROFILES_COLLECTION } = await import("../auth/profile-collection-name.js");
  const { resolveProfileAvatarUrl } = await import("../auth/profile-image-resolve.js");
  const refs = uids.map((uid) => db.collection(USER_PROFILES_COLLECTION).doc(uid));
  const profileSnaps = await db.getAll(...refs);

  /** @type {Map<string, string>} */
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

/** Direct parent id, or null. */
export async function getMemberParentId(db, memberId) {
  const rels = await getAllRelationships(db);
  for (const rel of rels) {
    if (rel.child_member_id === memberId) {
      return rel.parent_member_id;
    }
  }
  return null;
}

/**
 * All ancestors (walk up).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<TreeNode[]>}
 */
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
  const visited = new Set(); // Prevent infinite loops

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

  return ancestors.reverse(); // Root first
}

/**
 * All descendants (walk down).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {number} maxDepth - Maximum depth to traverse (default: 10)
 * @returns {Promise<TreeNode[]>}
 */
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

/**
 * Path from tree root to member.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<string[]>} - Array of member IDs from root to this member
 */
export async function getMemberTreePath(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  const path = ancestors.map(a => a.member_id);
  path.push(memberId);
  return path;
}

/**
 * True if A is an ancestor of B.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} potentialAncestorId
 * @param {string} memberId
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(db, potentialAncestorId, memberId) {
  const path = await getMemberTreePath(db, memberId);
  return path.includes(potentialAncestorId);
}

/**
 * Top-most ancestor (tree root).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<string|null>} - Root member ID or null
 */
export async function getMemberRoot(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  return ancestors.length > 0 ? ancestors[0].member_id : memberId;
}

/**
 * Everyone in the same connected tree component.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<{root_id: string, members: string[]}>}
 */
export async function getConnectedMembers(db, memberId) {
  const rootId = await getMemberRoot(db, memberId);
  const descendants = await getMemberDescendants(db, rootId);
  const members = [rootId, ...descendants.map(d => d.member_id)];

  return {
    root_id: rootId,
    members: [...new Set(members)], // Deduplicate
  };
}

/**
 * Project co-members (for client visibility).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<string[]>} - Array of member IDs who share at least one project
 */
export async function getMembersBySharedProjects(db, memberId) {
  // Get the member's projects
  const memberDoc = await db.collection("members").doc(memberId).get();
  if (!memberDoc.exists) return [];

  const memberData = memberDoc.data();
  const memberProjects = memberData.projects || [];

  if (memberProjects.length === 0) return [];

  // Find all members who share at least one project
  const sharedMemberIds = new Set();

  // Query members collection for each project
  for (const projectId of memberProjects) {
    const membersWithProject = await db.collection("members")
      .where("projects", "array-contains", projectId)
      .limit(100)
      .get();

    for (const doc of membersWithProject.docs) {
      if (doc.id !== memberId) {
        sharedMemberIds.add(doc.id);
      }
    }
  }

  return Array.from(sharedMemberIds);
}

/**
 * Client-visible members via project links only (not hierarchy).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @returns {Promise<{root_id: string | null, tree_members: string[], project_members: string[], all_visible: string[]}>}
 */
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

/** Org Owner member id for this viewer. */
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

/**
 * @param {string} roleName
 */
function isUplineOrgAdminRole(roleName) {
  return isOrganizationRootRole(roleName) || isOrganizationAdminRole(roleName);
}

/** Owner, Admin, Super Admin, Super Manager, Manager — visible read-only across the same org. */
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

/** Read-only org leadership ids (sibling managers + admin branches). */
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} ownerMemberId
 */
async function memberBelongsToOrg(db, memberId, ownerMemberId) {
  if (memberId === ownerMemberId) return true;
  const ancestors = await getMemberAncestors(db, memberId);
  if (ancestors.some((ancestor) => ancestor.member_id === ownerMemberId)) return true;

  const memberSnap = await db.collection("members").doc(memberId).get();
  if (!memberSnap.exists) return false;
  const data = memberSnap.data() || {};
  if (data.created_by === ownerMemberId) return true;

  const ownerSnap = await db.collection("members").doc(ownerMemberId).get();
  const ownerUid = ownerSnap.exists ? String(ownerSnap.data()?.firebase_uid || "").trim() : "";
  const createdByUid = String(data.created_by_uid || "").trim();
  return Boolean(ownerUid && createdByUid === ownerUid);
}

/** Owner/Admin/Super Admin member + firebase uids for an org. */
async function collectOrgAdminCreators(db, ownerMemberId) {
  const adminMemberIds = new Set([ownerMemberId]);
  const adminFirebaseUids = new Set();

  const ownerSnap = await db.collection("members").doc(ownerMemberId).get();
  if (ownerSnap.exists) {
    const uid = String(ownerSnap.data()?.firebase_uid || "").trim();
    if (uid) adminFirebaseUids.add(uid);
  }

  const descendants = await getMemberDescendants(db, ownerMemberId, 100);
  for (const node of descendants) {
    const roleName = await resolveMemberRoleName(db, node.member_id);
    if (!isUplineOrgAdminRole(roleName)) continue;
    adminMemberIds.add(node.member_id);
    const snap = await db.collection("members").doc(node.member_id).get();
    const uid = String(snap.data()?.firebase_uid || "").trim();
    if (uid) adminFirebaseUids.add(uid);
  }

  return { adminMemberIds, adminFirebaseUids };
}

/** Members added by Owner/Admin — Managers can manage outside their subtree. */
async function getOrgUplineAddedMemberIds(db, viewerMemberId) {
  const ownerMemberId = await resolveSharedOrgOwnerMemberId(db, viewerMemberId);
  if (!ownerMemberId) return [];

  const viewerInOrg = await memberBelongsToOrg(db, viewerMemberId, ownerMemberId);
  if (!viewerInOrg) return [];

  const { adminMemberIds, adminFirebaseUids } = await collectOrgAdminCreators(db, ownerMemberId);
  const candidateIds = new Set();

  for (const uid of adminFirebaseUids) {
    try {
      const snap = await db
        .collection("members")
        .where("created_by_uid", "==", uid)
        .limit(500)
        .get();
      for (const doc of snap.docs) candidateIds.add(doc.id);
    } catch (err) {
      logSafeWarn("[getOrgUplineAddedMemberIds] created_by_uid lookup failed:", err);
    }
  }

  for (const adminId of adminMemberIds) {
    try {
      const snap = await db
        .collection("members")
        .where("created_by", "==", adminId)
        .limit(500)
        .get();
      for (const doc of snap.docs) candidateIds.add(doc.id);
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

/** Management subtree: self + everyone they added (tree "team" scope). */
export async function getTeamSubtreeMemberIds(db, memberId, maxDepth = 100) {
  const ids = new Set([memberId]);
  const descendants = await getMemberDescendants(db, memberId, maxDepth);
  for (const d of descendants) {
    ids.add(d.member_id);
  }

  const memberSnap = await db.collection("members").doc(memberId).get();
  const firebaseUid =
    memberSnap.exists && typeof memberSnap.data()?.firebase_uid === "string"
      ? memberSnap.data().firebase_uid.trim()
      : "";
  if (firebaseUid) {
    try {
      const addedSnap = await db
        .collection("members")
        .where("created_by_uid", "==", firebaseUid)
        .limit(500)
        .get();
      for (const doc of addedSnap.docs) {
        ids.add(doc.id);
        const nested = await getMemberDescendants(db, doc.id, maxDepth);
        for (const d of nested) ids.add(d.member_id);
      }
    } catch (err) {
      logSafeWarn("[getTeamSubtreeMemberIds] created_by_uid lookup failed:", err);
    }
  }

  return [...ids];
}

/** Read-only upline in viewer's branch (Owner/Admin/Super Admin/Super Manager). */
async function getSubtreeUplineReadOnlyMemberIds(db, memberId) {
  const ancestors = await getMemberAncestors(db, memberId);
  return ancestors.map((ancestor) => ancestor.member_id);
}

/** Manager/Super Manager: subtree + org members added by Owner/Admin. */
export async function getManagerVisibleMemberIds(db, memberId) {
  const [subtree, uplineAdded] = await Promise.all([
    getTeamSubtreeMemberIds(db, memberId),
    getOrgUplineAddedMemberIds(db, memberId),
  ]);
  return [...new Set([...subtree, ...uplineAdded])];
}

/** People page ids for Manager/Super Manager (manageable + read-only upline). */
export async function getManagerPeoplePageVisibleMemberIds(db, memberId) {
  const [manageable, uplineReadOnly, orgLeadership] = await Promise.all([
    getManagerVisibleMemberIds(db, memberId),
    getSubtreeUplineReadOnlyMemberIds(db, memberId),
    getOrgLeadershipReadOnlyMemberIds(db, memberId),
  ]);
  return [...new Set([...manageable, ...uplineReadOnly, ...orgLeadership])];
}

/** Drop member ids the actor can't mutate by role rank. */
async function filterManageableMemberIdsByRole(db, actorRoleName, memberIds) {
  const manageable = [];
  for (const id of memberIds) {
    const roleName = await resolveMemberRoleName(db, id);
    if (canActorManageTargetRole(actorRoleName, roleName)) manageable.push(id);
  }
  return manageable;
}

/** Mutable member ids (edit/remove/batch) — narrower than visible. */
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

/** Owner org tree member ids (read-only for employees). */
async function getOwnerOrgMemberIds(db, ownerMemberId) {
  const ids = new Set([ownerMemberId]);
  const descendants = await getMemberDescendants(db, ownerMemberId, 100);
  for (const d of descendants) ids.add(d.member_id);
  return [...ids];
}

/** Employee read-only tree: shared Owner root → full subtree; else manager branch or self. */
export async function getEmployeeHierarchyMemberIds(db, memberId) {
  const ownerMemberId = await resolveSharedOrgOwnerMemberId(db, memberId);
  if (ownerMemberId && (await memberBelongsToOrg(db, memberId, ownerMemberId))) {
    return getOwnerOrgMemberIds(db, ownerMemberId);
  }

  const ancestors = await getMemberAncestors(db, memberId);
  const directParentId =
    ancestors.length > 0 ? ancestors[ancestors.length - 1].member_id : null;
  if (directParentId) {
    return getTeamSubtreeMemberIds(db, directParentId);
  }
  return getTeamSubtreeMemberIds(db, memberId);
}

/**
 * Visible member ids for the signed-in viewer.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 * @param {string} roleName
 * @returns {Promise<string[] | null>} - Array of visible member IDs, or null if can see all
 */
export async function getVisibleMemberIds(db, memberId, roleName) {
  if (!roleName) return [memberId];
  const role = roleName.trim().toLowerCase().replace(/\s+/g, "");
  
  if (["superadmin", "owner", "admin"].includes(role)) {
    return null; // Can see everyone (Admin matches frontend behavior)
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
  
  // Viewer and unknown roles: self only
  return [memberId];
}

/**
 * Nested tree for UI display.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} rootMemberId
 * @returns {Promise<Object>} - Tree structure
 */
export async function buildMemberTree(db, rootMemberId) {
  const descendants = await getMemberDescendants(db, rootMemberId);

  // Build adjacency list
  const children = new Map();
  children.set(rootMemberId, []);

  for (const desc of descendants) {
    if (!children.has(desc.member_id)) {
      children.set(desc.member_id, []);
    }
  }

  // Populate parent-child relationships in memory
  const rels = await getAllRelationships(db);
  for (const rel of rels) {
    if (children.has(rel.parent_member_id)) {
      children.get(rel.parent_member_id).push({
        member_id: rel.child_member_id,
        relationship_type: rel.relationship_type,
      });
    }
  }

  // Build nested tree
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

// Cache management

async function getCachedTreeData(db, memberId) {
  return getMemberTreeCache(db, memberId);
}

async function invalidateTreeCache(db, memberId) {
  await deleteMemberTreeCache(db, memberId);
}

/**
 * Refresh member_tree_cache after edge changes.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
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

/** Clears in-memory relationship cache (unit tests only). */
export function resetMemberRelationshipsCacheForTests() {
  allRelationshipsCache = null;
  lastLoadTime = 0;
  lastIntegrityRepairAt = 0;
}
