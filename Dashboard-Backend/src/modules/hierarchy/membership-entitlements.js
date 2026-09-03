
export function hasIndependentHierarchyEntitlement(memberData) {
  if (!memberData || typeof memberData !== "object") return false;

  const entitlements = memberData.hierarchy_entitlements;
  if (entitlements && typeof entitlements === "object") {
    if (entitlements.independent_hierarchy === true) return true;
  }

  if (memberData.independent_hierarchy === true) return true;

  return false;
}

export function buildIndependentHierarchyEntitlement() {
  return {
    hierarchy_entitlements: {
      independent_hierarchy: true,
      granted_at: new Date(),
    },
  };
}
