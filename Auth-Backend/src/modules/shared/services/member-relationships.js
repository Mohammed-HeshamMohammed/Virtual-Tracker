import crypto from "node:crypto";
import { normalizeRoleKey } from "./relation-sync.js";
import { resolveMemberRoleName } from "./activity-scope.js";
import { isExcludedFromHierarchy } from "./hierarchy-placement.js";
import {
  RelationshipIntegrityError,
  validateNewRelationshipWithRoles,
} from "./relationship-integrity.js";

/** @type {Array<{ id: string, parent_member_id: string, child_member_id: string, created_at?: unknown }> | null} */
let allRelationshipsCache = null;

async function loadValidationEdgesForNewRelationship(db, parentMemberId, childMemberId) {
  /** @type {Map<string, { id: string, parent_member_id: string, child_member_id: string, created_at?: unknown }>} */
  const edges = new Map();
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
  let frontier = asParentSnap.docs.map((doc) => doc.data()?.child_member_id).filter((id) => typeof id === "string" && id);
  const seen = new Set([childMemberId, ...frontier]);
  while (frontier.length > 0) {
    const batch = frontier.slice(0, 10);
    frontier = frontier.slice(10);
    const snap = await db.collection("member_relationships").where("parent_member_id", "in", batch).limit(500).get();
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

async function loadEdgesForRelationshipValidation(db, parentMemberId, childMemberId, options = {}) {
  if (options.useFullGraph) {
    if (allRelationshipsCache) return allRelationshipsCache;
    const snap = await db.collection("member_relationships").limit(2000).get();
    allRelationshipsCache = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return allRelationshipsCache;
  }
  return loadValidationEdgesForNewRelationship(db, parentMemberId, childMemberId);
}

async function invalidateTreeCache(db, memberId) {
  await db.collection("member_tree_cache").doc(memberId).delete().catch(() => {});
}

export async function getVisibleMemberIds(db, memberId, roleName) {
  if (!roleName) return [memberId];
  const role = roleName.trim().toLowerCase().replace(/\s+/g, "");
  if (["superadmin", "owner", "admin"].includes(role)) {
    return null;
  }
  return [memberId];
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

  const existingEdges = await loadEdgesForRelationshipValidation(db, parentMemberId, childMemberId, { useFullGraph });
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

  const existing = await db.collection("member_relationships")
    .where("parent_member_id", "==", parentMemberId)
    .where("child_member_id", "==", childMemberId)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    const existingData = doc.data();
    if (projects.length > 0) {
      const mergedProjects = [...new Set([...(existingData.projects || []), ...projects])];
      if (mergedProjects.length !== (existingData.projects || []).length) {
        await db.collection("member_relationships").doc(doc.id).update({ projects: mergedProjects });
        allRelationshipsCache = null;
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
  allRelationshipsCache = null;

  if (deferTreeCache) {
    void invalidateTreeCache(db, parentMemberId);
    void invalidateTreeCache(db, childMemberId);
  } else {
    await invalidateTreeCache(db, parentMemberId);
    await invalidateTreeCache(db, childMemberId);
  }

  return relationship;
}

export function resetMemberRelationshipsCacheForTests() {
  allRelationshipsCache = null;
}
