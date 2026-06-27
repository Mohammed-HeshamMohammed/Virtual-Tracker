export function hasIndependentHierarchyEntitlement(memberData) {
  return Boolean(memberData && memberData.independent_hierarchy === true);
}
