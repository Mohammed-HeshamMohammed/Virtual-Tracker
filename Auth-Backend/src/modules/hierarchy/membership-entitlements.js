/**
 * Membership entitlements — future-compatible hooks for paid hierarchy ownership.
 *
 * When membership purchases are implemented, set `hierarchy_entitlements.independent_hierarchy`
 * on the member document (or link via a subscriptions collection).
 */

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

/**
 * Build entitlement payload for granting independent hierarchy ownership.
 * Used by future membership upgrade flows.
 *
 * @returns {{ hierarchy_entitlements: { independent_hierarchy: boolean, granted_at: Date } }}
 */
export function buildIndependentHierarchyEntitlement() {
  return {
    hierarchy_entitlements: {
      independent_hierarchy: true,
      granted_at: new Date(),
    },
  };
}
