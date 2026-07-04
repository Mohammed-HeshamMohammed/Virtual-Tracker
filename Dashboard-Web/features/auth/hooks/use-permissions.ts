"use client"

import { useMemo } from "react"
import { useAuth } from "@/shared/providers/app"
import {
  normalizeMemberRole,
  canAccessAllSidebarTabs,
  canCreateTasks,
  canAccessReviewCenter,
  canSeePmTasksSection,
  canViewParticipationMetrics,
  isEmployeeRole,
  isClientOrViewerRole,
  canUseBatchMemberActions,
  canManageMemberBans,
} from "@/features/auth/permissions/member-role-access"
import { canApproveDeactivationRequests } from "@/features/auth/permissions/role-hierarchy"
import { canCreateTeams, hasManageEmployeeTeamsPrivilege } from "@/features/auth/permissions/team-member-assign-policy"

/** UI permission hints from auth context (backend enforces). */
export function usePermissions() {
  const { memberRole, currentMember } = useAuth()
  const role = memberRole ?? ""

  return useMemo(() => {
    const normalizedRole = normalizeMemberRole(role)
    const isSuperAdmin = normalizedRole === "superadmin"
    const isOwner = normalizedRole === "owner"
    const isAdminOrOwner = isSuperAdmin || normalizedRole === "admin" || isOwner
    const isManager = normalizedRole === "manager"
    const isSuperManager = normalizedRole === "supermanager" || normalizedRole === "supermanger"
    const isManagerScopedRole = isManager || isSuperManager
    const isViewer = isClientOrViewerRole(role)
    const isEmployee = isEmployeeRole(role)
    const manageEmployeeTeams = hasManageEmployeeTeamsPrivilege(currentMember)
    const canManageTeamsAccess = canCreateTeams(role, currentMember)

    return {
      memberRole: role,
      normalizedRole,
      isSuperAdmin,
      isOwner,
      isAdminOrOwner,
      isManager,
      isSuperManager,
      isManagerScopedRole,
      isEmployee,
      isViewer,
      manageEmployeeTeams,
      canManageAllMembers: isAdminOrOwner,
      canManageTreeMembers: isManagerScopedRole,
      canManageMembers: isAdminOrOwner || isManagerScopedRole,
      canUseBatchMemberActions: canUseBatchMemberActions(role),
      canManageMemberBans: canManageMemberBans(role),
      canRemoveMemberFromTree: canUseBatchMemberActions(role),
      canCreateTransferRequests: isManagerScopedRole,
      canViewMembersTree: isAdminOrOwner || isManagerScopedRole,
      canSeeAllMembers: isAdminOrOwner,
      canApproveDeactivationRequests: canApproveDeactivationRequests(role),
      canManageTeams: canManageTeamsAccess,
      canAccessAllSidebarTabs: canAccessAllSidebarTabs(role),
      canCreateTasks: canCreateTasks(role),
      canAccessReviewCenter: canAccessReviewCenter(role),
      canSeePmTasksSection: canSeePmTasksSection(role),
      canViewParticipationMetrics: canViewParticipationMetrics(role),
    }
  }, [role, currentMember])
}
