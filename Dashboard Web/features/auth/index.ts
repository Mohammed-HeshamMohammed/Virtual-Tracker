export { AuthSessionLoader } from "@/features/auth/components";
export { MemberPresenceReporter } from "@/features/auth/components/member-presence-reporter";
export { PresenceEventsSubscriber } from "@/features/auth/components/presence-events-subscriber";
export { 
  canAccessAllSidebarTabs, 
  coerceNavItemForRole, 
  canCreateTasks, 
  canViewParticipationMetrics, 
  normalizeMemberRole, 
  getMemberRoleLabel, 
  canManageTimesheetApprovals, 
  canAccessReviewCenter, 
  canReviewAssignments, 
  canSeePmTasksSection,
  canExportActivity,
  canManageActivityData,
  canManageClients,
  canManageProjects,
  isOwnerRoleName,
  isEmployeeRole,
  isClientOrViewerRole,
  canUseBatchMemberActions,
  canManageMemberBans,
  extractRoleFromRecord,
  defaultNavItemForRole,
  isEmployeeL2OrHigherRole,
  isLimitedSelfManageRole,
  isManagementRole
} from "@/features/auth/permissions/member-role-access";
export { registerDashboardPresence, subscribeAgentLinked, broadcastAgentLinked, pingDashboardTab } from "@/features/auth/services/agent-link-broadcast";
export { broadcastAuthSessionReady, subscribeAuthSessionReady } from "@/features/auth/services/auth-cross-tab-sync";
export { DASHBOARD_PATH, finishAgentLinkSuccess } from "@/features/auth/services/navigation";
export { PasswordPolicyProvider } from "@/features/auth/services/password-policy";
export { useAppShellReady } from "@/features/auth/hooks/use-app-shell-ready";
export { usePasswordPolicy } from "@/features/auth/services/password-policy/password-policy-context";
export { analyzePassword, strengthToLabel, isRequirementMet } from "@/features/auth/services/password-policy/analyze";
export { usePasswordBackendCheck } from "@/features/auth/services/password-policy/use-password-backend-check";
export { buildPasswordChecklist } from "@/features/auth/services/password-policy/checklist";
