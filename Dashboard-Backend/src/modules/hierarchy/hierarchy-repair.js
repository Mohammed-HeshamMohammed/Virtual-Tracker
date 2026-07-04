import { resolveMemberRoleName } from "../activity/activity-scope.js";
import { recordMemberRelationship, removeMemberParentEdge } from "../member-relationships/service.js";
import { planOwnerRootSeparationRepairs } from "../member-relationships/relationship-integrity.js";
import { syncMemberPrimaryRole } from "../members/services/relation-sync.js";
import { normalizeRoleKey } from "../members/services/relation-sync.js";
import {
  classifyHierarchyPlacement,
  isOrphanEmployeeViolation,
  isExcludedFromHierarchy,
} from "./hierarchy-placement.js";
import { syncMemberHierarchyStatus } from "./hierarchy-sync.js";

/**
 * @typedef {"assign_to_owner" | "downgrade_to_viewer"} OrphanRepairStrategy
 */

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @returns {Promise<string | null>}
 */
export async function resolveOrganizationRootMemberId(db) {
  const membersSnap = await db.collection("members").limit(500).get();
  let fallbackId = null;
  let fallbackRank = -1;
  const rank = { superadmin: 90, admin: 80 };

  for (const doc of membersSnap.docs) {
    const roleName = await resolveMemberRoleName(db, doc.id);
    const key = normalizeRoleKey(roleName);
    if (key === "owner") {
      return doc.id;
    }
    const r = rank[key] ?? -1;
    if (r > fallbackRank) {
      fallbackRank = r;
      fallbackId = doc.id;
    }
  }

  return fallbackId;
}

/** Members with invalid hierarchy placement (orphan employees, etc.). */
export async function findOrphanHierarchyViolations(db) {
  const [membersSnap, relsSnap] = await Promise.all([
    db.collection("members").limit(2000).get(),
    db.collection("member_relationships").limit(4000).get(),
  ]);

  const childToParent = new Map();
  for (const doc of relsSnap.docs) {
    const d = doc.data() || {};
    if (typeof d.child_member_id === "string" && typeof d.parent_member_id === "string") {
      childToParent.set(d.child_member_id, d.parent_member_id);
    }
  }

  /** @type {Array<{ member_id: string; role_name: string; parent_member_id: string | null; violation_type: string }>} */
  const violations = [];

  for (const doc of membersSnap.docs) {
    const data = doc.data() || {};
    const memberId = doc.id;
    const roleName = await resolveMemberRoleName(db, memberId);
    const parentId = childToParent.get(memberId) ?? null;
    const placement = classifyHierarchyPlacement(roleName, parentId, data);

    if (placement === "external" || isExcludedFromHierarchy(roleName)) continue;
    if (placement !== "invalid") continue;

    let violationType = "hierarchy_placement_invalid";
    if (isOrphanEmployeeViolation(roleName, parentId)) {
      violationType = "orphan_employee";
    }

    violations.push({
      member_id: memberId,
      role_name: roleName,
      parent_member_id: parentId,
      violation_type: violationType,
    });
  }

  return violations;
}

/** Fix orphan members — assign to org root or downgrade to Viewer. */
export async function repairOrphanHierarchyMembers(db, options = {}) {
  const strategy = options.strategy === "downgrade_to_viewer" ? "downgrade_to_viewer" : "assign_to_owner";
  const dryRun = options.dryRun !== false;
  const actorMemberId = typeof options.actorMemberId === "string" ? options.actorMemberId : "system";

  const violations = await findOrphanHierarchyViolations(db);
  if (!violations.length) {
    return { repaired: false, dryRun, strategy, actions: [], violation_count: 0 };
  }

  const orgRootId = strategy === "assign_to_owner" ? await resolveOrganizationRootMemberId(db) : null;
  /** @type {Array<Record<string, unknown>>} */
  const actions = [];

  for (const violation of violations) {
    if (strategy === "assign_to_owner") {
      if (!orgRootId) {
        actions.push({
          member_id: violation.member_id,
          skipped: true,
          reason: "No organization root (Owner/Admin) found.",
        });
        continue;
      }
      if (orgRootId === violation.member_id) {
        actions.push({ member_id: violation.member_id, skipped: true, reason: "Member is the org root." });
        continue;
      }

      if (dryRun) {
        actions.push({
          member_id: violation.member_id,
          action: "assign_parent",
          parent_member_id: orgRootId,
          role_name: violation.role_name,
        });
        continue;
      }

      try {
        await recordMemberRelationship(db, {
          parentMemberId: orgRootId,
          childMemberId: violation.member_id,
          relationshipType: "admin_create",
          createdBy: actorMemberId,
        });
        await syncMemberHierarchyStatus(db, violation.member_id, violation.role_name);
        actions.push({
          member_id: violation.member_id,
          action: "assign_parent",
          parent_member_id: orgRootId,
          repaired: true,
        });
      } catch (e) {
        actions.push({
          member_id: violation.member_id,
          action: "assign_parent",
          error: e instanceof Error ? e.message : "Failed to assign parent.",
        });
      }
      continue;
    }

    if (dryRun) {
      actions.push({
        member_id: violation.member_id,
        action: "downgrade_to_viewer",
        from_role: violation.role_name,
      });
      continue;
    }

    try {
      await syncMemberPrimaryRole(db, violation.member_id, "Viewer", actorMemberId);
      await syncMemberHierarchyStatus(db, violation.member_id, "Viewer");
      actions.push({
        member_id: violation.member_id,
        action: "downgrade_to_viewer",
        from_role: violation.role_name,
        repaired: true,
      });
    } catch (e) {
      actions.push({
        member_id: violation.member_id,
        action: "downgrade_to_viewer",
        error: e instanceof Error ? e.message : "Failed to downgrade role.",
      });
    }
  }

  const repairedCount = actions.filter((a) => a.repaired === true).length;
  return {
    repaired: repairedCount > 0,
    dryRun,
    strategy,
    violation_count: violations.length,
    repaired_count: repairedCount,
    org_root_id: orgRootId,
    actions,
  };
}

let lastOrphanRepairAt = 0;
let lastOwnerSeparationRepairAt = 0;
const ORPHAN_REPAIR_COOLDOWN_MS = 5 * 60 * 1000;

/** Auto-fix orphans on tree load (5m cooldown). */
export async function maybeRepairOrphansOnTreeLoad(db, actorMemberId) {
  const now = Date.now();
  if (now - lastOrphanRepairAt < ORPHAN_REPAIR_COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown" };
  }

  const violations = await findOrphanHierarchyViolations(db);
  if (!violations.length) {
    return { skipped: true, reason: "no_violations" };
  }

  lastOrphanRepairAt = now;
  return repairOrphanHierarchyMembers(db, {
    strategy: "assign_to_owner",
    dryRun: false,
    actorMemberId,
  });
}

/** Drop hierarchy edges for Client/external roles. */
export async function cleanupExternalEntityHierarchyEdges(db) {
  const { removeMemberHierarchyRelationships } = await import("../member-relationships/service.js");
  const membersSnap = await db.collection("members").limit(2000).get();
  let removedEdges = 0;
  let membersCleaned = 0;

  for (const doc of membersSnap.docs) {
    const roleName = await resolveMemberRoleName(db, doc.id);
    if (!isExcludedFromHierarchy(roleName)) continue;
    const count = await removeMemberHierarchyRelationships(db, doc.id);
    if (count > 0) {
      removedEdges += count;
      membersCleaned += 1;
    }
    await syncMemberHierarchyStatus(db, doc.id, roleName);
  }

  return { removed_edges: removedEdges, members_cleaned: membersCleaned };
}

/** Split nested Owners — remove Owner→Owner edge only; subtree stays under nested Owner. */
export async function repairOwnerUnderOwnerRelationships(db, options = {}) {
  const dryRun = options.dryRun === true;
  const relsSnap = await db.collection("member_relationships").limit(4000).get();
  const edges = relsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const memberIds = new Set();
  for (const edge of edges) {
    if (typeof edge.parent_member_id === "string") memberIds.add(edge.parent_member_id);
    if (typeof edge.child_member_id === "string") memberIds.add(edge.child_member_id);
  }

  const roleKeyByMemberId = new Map();
  for (const memberId of memberIds) {
    const roleName = await resolveMemberRoleName(db, memberId);
    roleKeyByMemberId.set(memberId, normalizeRoleKey(roleName));
  }

  const toRemove = planOwnerRootSeparationRepairs(edges, roleKeyByMemberId);
  if (!toRemove.length) {
    return { repaired: false, dryRun, removed: [], separated_owners: [] };
  }

  if (dryRun) {
    return {
      repaired: false,
      dryRun: true,
      removed: toRemove,
      separated_owners: toRemove.map((item) => item.edge.child_member_id),
    };
  }

  /** @type {string[]} */
  const separatedOwners = [];
  for (const item of toRemove) {
    const childOwnerId = item.edge.child_member_id;
    const removed = await removeMemberParentEdge(db, childOwnerId);
    if (removed > 0) {
      separatedOwners.push(childOwnerId);
      const roleName = await resolveMemberRoleName(db, childOwnerId);
      await syncMemberHierarchyStatus(db, childOwnerId, roleName);
    }
  }

  return {
    repaired: separatedOwners.length > 0,
    dryRun: false,
    removed: toRemove,
    separated_owners: separatedOwners,
  };
}

/** Auto-split Owner-under-Owner on tree load (5m cooldown). */
export async function maybeSeparateOwnersOnTreeLoad(db) {
  const now = Date.now();
  if (now - lastOwnerSeparationRepairAt < ORPHAN_REPAIR_COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown" };
  }

  const preview = await repairOwnerUnderOwnerRelationships(db, { dryRun: true });
  if (!preview.removed.length) {
    return { skipped: true, reason: "no_owner_nesting" };
  }

  lastOwnerSeparationRepairAt = now;
  return repairOwnerUnderOwnerRelationships(db, { dryRun: false });
}
