// Paid hierarchy ownership hooks — set hierarchy_entitlements.independent_hierarchy on member.

/**
 * @param {Record<string, unknown> | null | undefined} memberData
 * @returns {boolean}
 */
export function hasIndependentHierarchyEntitlement(memberData) {
  if (!memberData || typeof memberData !== "object") return false;

  const entitlements = memberData.hierarchy_entitlements;
  if (entitlements && typeof entitlements === "object") {
    if (entitlements.independent_hierarchy === true) return true;
  }

  // Legacy / bootstrap flag for testing independent hierarchy roots
  if (memberData.independent_hierarchy === true) return true;

  return false;
}

/** Payload for granting independent hierarchy root (future billing flow). */
export function buildIndependentHierarchyEntitlement() {
  return {
    hierarchy_entitlements: {
      independent_hierarchy: true,
      granted_at: new Date(),
    },
  };
}
