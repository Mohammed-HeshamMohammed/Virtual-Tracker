import type { ProjectFormField } from "@/features/projects/api/project-form-api"
import {
  isEmployeeRole,
  isManagementRole,
  normalizeMemberRole,
} from "@/features/auth"

export function memberMatchesProjectFormRoleFilter(
  role: string | undefined,
  roleFilter: ProjectFormField["roleFilter"],
): boolean {
  const label = role ?? ""
  if (!roleFilter) {
    return isManagementRole(label) || isEmployeeRole(label)
  }
  switch (roleFilter) {
    case "manager_and_above":
      return isManagementRole(label)
    case "employee":
      return isEmployeeRole(label)
    case "client":
      return normalizeMemberRole(label) === "client"
    default:
      return true
  }
}

export function filterProjectFormMemberIds(
  memberIds: string[],
  roleFilter: ProjectFormField["roleFilter"],
  roleByMemberId: ReadonlyMap<string, string>,
): string[] {
  return memberIds.filter((id) =>
    memberMatchesProjectFormRoleFilter(roleByMemberId.get(id), roleFilter),
  )
}
