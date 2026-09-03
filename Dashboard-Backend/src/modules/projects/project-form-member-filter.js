import { isManagementRole } from "../../http/auth-context.js";
import { isEmployeeRole } from "../../http/role-hierarchy.js";
import { normalizeRoleKey } from "../members/services/relation-sync.js";

export function memberMatchesProjectFormRoleFilter(roleName, roleFilter) {
  const label = typeof roleName === "string" ? roleName : "";
  if (!roleFilter) {
    return isManagementRole(label) || isEmployeeRole(label);
  }
  const key = normalizeRoleKey(label);
  switch (roleFilter) {
    case "manager_and_above":
      return isManagementRole(label);
    case "employee":
      return isEmployeeRole(label);
    case "client":
      return key === "client";
    default:
      return true;
  }
}
