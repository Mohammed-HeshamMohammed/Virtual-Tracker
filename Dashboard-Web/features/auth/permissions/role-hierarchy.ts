import type { MemberRole } from "@/features/members/models/member"
import { normalizeMemberRole } from "@/features/auth/permissions/member-role-access"

/** Mirrors Backend `ROLE_PRIVILEGE_RANK` in relation-sync.js */
const ROLE_PRIVILEGE_RANK: Record<string, number> = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  teamlead: 50,
  employee: 40,
  intern: 30,
  client: 20,
  viewer: 10,
}

export const ASSIGNABLE_ROLE_NAMES: MemberRole[] = [
  "Super Admin",
  "Admin",
  "Super Manager",
  "Manager",
  "Team Lead",
  "Employee",
  "Intern",
  "Client",
  "Viewer",
]

function roleRank(roleName: string): number {
  const key = normalizeMemberRole(roleName)
  if (!key) return -1
  return ROLE_PRIVILEGE_RANK[key] ?? 35
}

export function isAdminLevelRole(roleName: string): boolean {
  const key = normalizeMemberRole(roleName)
  return key === "admin" || key === "superadmin" || key === "owner"
}

export function isEmployeeRole(roleName: string): boolean {
  const key = normalizeMemberRole(roleName)
  return key === "intern" || key === "employee" || key === "teamlead"
}

export function canCreateMembers(roleName: string): boolean {
  const key = normalizeMemberRole(roleName)
  return (
    key === "owner" ||
    key === "superadmin" ||
    key === "admin" ||
    key === "supermanager" ||
    key === "manager"
  )
}

export function maxAssignableRank(actorRoleName: string): number {
  const key = normalizeMemberRole(actorRoleName)
  const actorRank = roleRank(actorRoleName)
  if (key === "owner") return ROLE_PRIVILEGE_RANK.superadmin
  if (!canCreateMembers(actorRoleName)) return -1
  return actorRank - 10
}

export function canAssignRole(actorRoleName: string, targetRoleName: string): boolean {
  const targetKey = normalizeMemberRole(targetRoleName)
  if (targetKey === "owner") return false
  if (!canCreateMembers(actorRoleName)) return false
  const targetRank = roleRank(targetRoleName)
  if (targetRank < 0) return false
  return targetRank <= maxAssignableRank(actorRoleName)
}

export function listAssignableRoles(actorRoleName: string): MemberRole[] {
  return ASSIGNABLE_ROLE_NAMES.filter((name) => canAssignRole(actorRoleName, name))
}

export function canManageAllTeams(roleName: string): boolean {
  const key = normalizeMemberRole(roleName)
  return (
    key === "owner" ||
    key === "superadmin" ||
    key === "admin" ||
    key === "supermanager" ||
    key === "supermanger"
  )
}

/** Manager — subtree-scoped team create; full roster control only on teams they lead. */
export function isManagerRole(roleName: string): boolean {
  return normalizeMemberRole(roleName) === "manager"
}

export function isOwnerRole(roleName: string): boolean {
  return normalizeMemberRole(roleName) === "owner"
}

/** Returns an error message when an Owner role change is attempted. */
export function validateOwnerRoleChange(currentRole: string, nextRole: string): string | null {
  const next = nextRole.trim()
  if (!next) return null
  if (normalizeMemberRole(currentRole) === normalizeMemberRole(next)) return null
  if (isOwnerRole(currentRole)) return "The Owner role cannot be changed through the application."
  if (isOwnerRole(next)) return "The Owner role cannot be assigned through the application."
  return null
}

export function canApproveDeactivationRequests(roleName: string): boolean {
  return isAdminLevelRole(roleName)
}

/** Target role keys an actor may not edit or remove (mirrors Backend role-manage-policy.js). */
const BLOCKED_TARGET_KEYS_BY_ACTOR: Record<string, Set<string>> = {
  owner: new Set(["owner"]),
  superadmin: new Set(["owner", "superadmin"]),
  admin: new Set(["owner", "superadmin"]),
  supermanager: new Set(["owner", "admin", "superadmin"]),
  supermanger: new Set(["owner", "admin", "superadmin"]),
  manager: new Set(["owner", "admin", "superadmin", "supermanager", "supermanger"]),
}

/** UI hint — server enforces via canManageMember and validateMemberRoleChange. */
export function canActorManageTargetRole(actorRoleName: string, targetRoleName: string): boolean {
  const actorKey = normalizeMemberRole(actorRoleName)
  const targetKey = normalizeMemberRole(targetRoleName)
  if (!actorKey || !targetKey) return false
  const blocked = BLOCKED_TARGET_KEYS_BY_ACTOR[actorKey]
  if (!blocked) return false
  return !blocked.has(targetKey)
}
