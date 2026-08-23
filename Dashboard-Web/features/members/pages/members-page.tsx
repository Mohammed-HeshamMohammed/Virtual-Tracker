/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useEffect, useMemo, useRef, useState as useComponentState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { AlertCircle, Check, Download, Network, RefreshCw, Search, ShieldBan, SlidersHorizontal, Table2, Upload, UserPlus, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { copyTextToClipboard } from "@/shared/utils/clipboard"
import { useTheme } from "@/shared/providers/app"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { useAuth } from "@/shared/providers/app"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import { usePageSearch } from "@/shared/ui/layout"
import { getInvites } from "@/infrastructure/api"
import { resolveInviteUrl } from "@/features/members/api/member-api"
import {
  ALL_MEMBER_COLS,
  MEMBER_IMPORT_EXPORT_COMING_SOON_MESSAGE,
  MEMBER_IMPORT_EXPORT_ENABLED,
} from "@/features/members/config/members-config"
import type { Member, MemberPatchBody, MemberEntryAction, Invite } from "@/features/members/models/member"
import type { PresenceDelta } from "@/features/auth/services/presence-events-sse"
import { isOwnerRoleName, getMemberRoleLabel, isLimitedSelfManageRole } from "@/features/auth"
import { canActorManageTargetRole } from "@/features/auth/permissions/role-hierarchy"
import { AddMembersModal, OnboardingModal, formatAddMembersPending, formatAddMembersSuccess } from "@/features/members/components/modals"
import { RecruitMemberModal } from "@/features/members/components/modals/recruit-member-modal"
import { NotifyToastHost } from "@/shared/ui/layout"
import type { NotifyAlertTone } from "@/shared/ui/alert-notify"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"
import { MembersTab, InvitesTab } from "@/features/members/components/tables"
import { BatchActionsDropdown } from "@/features/members/components/menus"
import { BatchEditModal, type BatchEditAction } from "@/features/members/components/modals/batch-edit-modal"
import { MemberFiltersPanel, type MemberListFilters } from "@/features/members/components/filters/member-filters-panel"
import { MembersSkeleton, InvitesSkeleton } from "@/features/members/components/skeletons"
import { MEMBERS_TABLE_ROWS_PER_PAGE, PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT } from "@/features/members/config/ui-config"
import { useResponsiveRowCap } from "@/shared/tables/hooks/use-responsive-row-cap"
import { INVITES_LIST_API_FIELDS } from "@/features/members/components/list-api-fields"
import { useCachedList } from "@/features/members/hooks"
import { changedEvent } from "@/infrastructure/api/change-events"
import { useMembersListData } from "@/features/members/hooks/use-members-list-data"
import {
  useAutoHiddenTableColumns,
  MEMBER_COL_AUTO_HIDE_PRIORITY,
  MEMBER_COL_MIN_WIDTH,
  getMembersTableFixedWidth,
} from "@/features/members/hooks/use-auto-hidden-table-columns"
import { TableRefreshButton, TableToolbarIconButton } from "@/shared/tables/ui"
import { MyTeamScopeIconButton } from "@/features/members/components/my-team-scope-controls"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"

// Custom hooks for extracted logic
import { useMemberColumns } from "@/features/members/hooks/use-member-columns"
import { useInviteColumns } from "@/features/members/hooks/use-invite-columns"
import { useMemberScope } from "@/features/members/hooks/use-members-hierarchy"
import { useMemberMutations } from "@/features/members/hooks/use-member-mutations"
import { isSameMember } from "@/features/members/utils/member-utils"
import { normalizeMemberRole } from "@/features/auth"

const EMPTY_MEMBER_FILTERS: MemberListFilters = { roles: [], projectIds: [] }

function memberMatchesFilters(member: Member, filters: MemberListFilters): boolean {
  if (filters.roles.length > 0) {
    const displayRole = member.role === "User" ? "Viewer" : (member.role_name || member.role || "")
    if (!filters.roles.includes(displayRole)) return false
  }
  if (filters.projectIds.length > 0) {
    const ids = member.projectIds ?? []
    if (!filters.projectIds.some((projectId) => ids.includes(projectId))) return false
  }
  return true
}

function roleSortKey(roleName: string): number {
  const rank: Record<string, number> = {
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
  return rank[normalizeMemberRole(roleName)] ?? 0
}

export function MembersPage({ onNavigate }: { onNavigate?: (id: string) => void } = {}) {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const tableRowCap = useResponsiveRowCap(PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT)
  const { user, memberRole, memberId: authMemberId, sessionReady, isLoggedIn, profile } = useAuth()
  const membersListEnabled = Boolean(sessionReady && isLoggedIn && !profile?.mustChangePassword)
  const [activeTab, setActiveTab] = useComponentState<"members" | "invites">("members")
  const [showAdd, setShowAdd] = useComponentState(false)
  // Bumped on every open so AddMembersModal gets a fresh `key` — otherwise AnimatePresence can
  // hand back the still-exiting instance instead of remounting, leaving stale state (isClosing
  // stuck true -> pointer-events-none never clears -> modal looks unresponsive).
  const addMembersInstanceRef = useRef(0)
  const [showRecruit, setShowRecruit] = useComponentState(false)
  const [showFilters, setShowFilters] = useComponentState(false)
  const [memberFilters, setMemberFilters] = useComponentState<MemberListFilters>(EMPTY_MEMBER_FILTERS)
  const [showOnboarding, setShowOnboarding] = useComponentState(false)
  const [addMembersToast, setAddMembersToast] = useComponentState<{
    message: string
    title: string
    tone: NotifyAlertTone
    inviteUrls?: string[]
  } | null>(null)
  const [isRefreshing, setIsRefreshing] = useComponentState(false)

  const {
    enabledCols,
    colOrder,
    draggedCol,
    sortCol,
    sortDir,
    toggleMemberCol,
    handleSort,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = useMemberColumns()

  const {
    canManageMembers,
    canManageMemberBans,
    canRemoveMemberFromTree,
    canUseBatchMemberActions,
    canCreateTransferRequests,
    canViewMembersTree,
    canSeeAllMembers,
    memberRole: viewerRole,
  } = usePermissions()

  const { canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading, refreshTeamMemberIds } = usePeopleTeamScope()

  const restrictedHiddenCols = new Set(["payment", "limits", "date_added"])
  const effectiveEnabledCols = canManageMembers
    ? enabledCols
    : new Set(Array.from(enabledCols).filter((key) => !restrictedHiddenCols.has(key)))

  const {
    members,
    setMembers,
    isLoading: membersLoading,
    loadingCols,
    error: membersError,
    requestedFields: membersListFields,
    refetch: refetchMembersList,
  } = useMembersListData({
    enabledCols: effectiveEnabledCols,
    memberFilters,
    sortCol,
    enabled: membersListEnabled,
  })

  const {
    data: invites,
    setData: setInvitesListData,
    isLoading: invitesLoading,
    refetch: refetchInvitesList,
  } = useCachedList<Invite[]>({
    cacheKey: "people-members:invites",
    fetch: () => getInvites({ fields: [...INVITES_LIST_API_FIELDS] }),
    staleMs: 300_000,
    minLoadingMs: 0,
    initialData: [],
    // Was the generic presence-ping heartbeat; changedEvent("invites") only
    // fires when invites actually changed (case 6), and forceRefetch
    // bypasses staleMs so it repaints without waiting on the next ping.
    presencePingEvent: changedEvent("invites"),
    backgroundRefetch: { forceRefetch: true },
  })

  const setInvites = (value: Invite[] | ((prev: Invite[]) => Invite[])): void => {
    setInvitesListData(value)
  }

  const isLoading = membersLoading || invitesLoading

  useEffect(() => {
    function onPresenceDelta(event: Event) {
      const detail = (event as CustomEvent<PresenceDelta>).detail
      if (!detail?.memberId || !detail.status) return
      setMembers((prev) => {
        let changed = false
        const next = prev.map((member) => {
          const matches =
            member.id === detail.memberId ||
            (member.firebaseUid && member.firebaseUid === detail.memberId)
          if (!matches) return member
          if (member.trackingStatus === detail.status) return member
          changed = true
          return { ...member, trackingStatus: detail.status }
        })
        return changed ? next : prev
      })
    }
    window.addEventListener("vt-presence-delta", onPresenceDelta)
    return () => window.removeEventListener("vt-presence-delta", onPresenceDelta)
  }, [setMembers])

  const [selectedMembers, setSelectedMembers] = useComponentState<Set<string>>(new Set())
  const [selectedInvites, setSelectedInvites] = useComponentState<Set<string>>(new Set())
  const { query: search, setQuery: setSearch } = usePageSearch()

  const [showMemberColPicker, setShowMemberColPicker] = useComponentState(false)
  const [batchAction, setBatchAction] = useComponentState<BatchEditAction | null>(null)

  const showMemberImportExportComingSoon = (feature: "Import" | "Export") => {
    setAddMembersToast({
      title: feature,
      tone: "info",
      message: MEMBER_IMPORT_EXPORT_COMING_SOON_MESSAGE,
    })
  }

  // Custom Invites Columns Hook
  const {
    inviteSortCol,
    inviteSortDir,
    inviteColOrder,
    draggedInviteCol,
    handleInviteSort,
    handleInviteDragStart,
    handleInviteDragOver,
    handleInviteDrop,
    handleInviteDragEnd,
  } = useInviteColumns()

  const currentEmail = (user?.email || "").trim().toLowerCase()
  const currentUid = (user?.uid || "").trim()
  const currentMemberRecord =
    members.find((m) => m.id === authMemberId) ??
    members.find((m) => (m.firebaseUid || "").trim() === currentUid) ??
    members.find((m) => (m.email || "").trim().toLowerCase() === currentEmail)
  const currentMemberId = authMemberId || currentMemberRecord?.id

  // Custom Hierarchy Hook
  const { visibleMemberIds: scopedVisibleIds, manageableMemberIds: scopedManageableIds, refreshScope } =
    useMemberScope({
    canSeeAllMembers,
    currentMemberId: authMemberId,
    sessionReady: sessionReady && isLoggedIn,
  })

  const scopedMembersRefetchRef = useRef(false)
  const managerCacheBustRef = useRef<string | null>(null)
  const postSessionRefetchRef = useRef(false)
  const isRefreshingRef = useRef(false)

  const refetchAllLists = useCallback(
    async (options: { forceRefetch?: boolean; showLoading?: boolean } = {}) => {
      await Promise.all([refetchMembersList(options), refetchInvitesList(options)])
    },
    [refetchMembersList, refetchInvitesList],
  )

  useEffect(() => {
    scopedMembersRefetchRef.current = false
  }, [currentMemberId])

  // Bust stale Viewer-era caches after promotion to Manager / Super Manager.
  useEffect(() => {
    if (canSeeAllMembers || !authMemberId) return
    const bustKey = `${authMemberId}:${memberRole}`
    if (managerCacheBustRef.current === bustKey) return
    managerCacheBustRef.current = bustKey
    void refetchAllLists({ forceRefetch: true, showLoading: false })
  }, [canSeeAllMembers, authMemberId, memberRole, refetchAllLists])

  useEffect(() => {
    if (!sessionReady || !isLoggedIn) {
      postSessionRefetchRef.current = false
      return
    }
    if (postSessionRefetchRef.current) return
    postSessionRefetchRef.current = true
    void refetchAllLists({
      forceRefetch: true,
      showLoading: false,
    })
  }, [sessionReady, isLoggedIn, refetchAllLists])

  useEffect(() => {
    if (canSeeAllMembers || scopedVisibleIds.size === 0 || scopedMembersRefetchRef.current) return
    if (isLoading || isRefreshing) return
    const known = new Set(members.map((m) => m.id))
    const missingVisibleMember = [...scopedVisibleIds].some((id) => !known.has(id))
    if (!missingVisibleMember) return
    scopedMembersRefetchRef.current = true
    void refetchMembersList({ forceRefetch: true, showLoading: false })
  }, [canSeeAllMembers, scopedVisibleIds, members, isLoading, isRefreshing, refetchMembersList])

  /** IDs the viewer may edit/remove — backend manageable scope + role policy. */
  const manageableMemberIds = useMemo(() => {
    if (canSeeAllMembers) {
      return new Set(
        members
          .filter((member) => canActorManageTargetRole(viewerRole, getMemberRoleLabel(member)))
          .map((member) => member.id),
      )
    }
    if (scopedManageableIds.size > 0) {
      return new Set(
        [...scopedManageableIds].filter((id) => {
          const member = members.find((m) => m.id === id)
          if (!member) return false
          return canActorManageTargetRole(viewerRole, getMemberRoleLabel(member))
        }),
      )
    }
    return new Set<string>()
  }, [canSeeAllMembers, scopedManageableIds, members, viewerRole])

  const handleRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return
    isRefreshingRef.current = true
    setIsRefreshing(true)
    try {
      await Promise.all([
        refetchAllLists({ forceRefetch: true, showLoading: false }),
        refreshTeamMemberIds(),
      ])
      refreshScope()
    } finally {
      isRefreshingRef.current = false
      setIsRefreshing(false)
    }
  }, [refetchAllLists, refreshScope, refreshTeamMemberIds, setIsRefreshing])

  // Custom Mutations Hook
  const {
    handleAddMembers,
    handleCreateShareLink,
    handlePatchMember,
    handleSaveProfile,
    handleRemoveMember,
    handleRemoveFromTree,
    handleRemoveMembers,
    handleBatchRemoveFromTree,
    handleBatchUpdateMembers,
    handlePatchInvite,
    handleRemoveInvite,
    handleResendInvite,
    handleCopyInviteLink,
    handleRenewInvite,
  } = useMemberMutations({
    user,
    currentMemberId,
    setMembers,
    setInvites,
    canManageMembers,
    canUseBatchMemberActions,
    manageableMemberIds,
    members,
    invites,
    canSeeAllMembers,
    membersListFields,
  })

  const visibleMembers = useMemo(() => {
    const deduped = (() => {
      const byKey = new Map<string, Member>()
      for (const m of members) {
        const key =
          (m.firebaseUid && `uid:${m.firebaseUid}`) ||
          ((m.email || "").trim().toLowerCase() && `email:${(m.email || "").trim().toLowerCase()}`) ||
          `id:${m.id}`
        if (!byKey.has(key)) byKey.set(key, m)
      }
      return Array.from(byKey.values()).filter((member) => member.status !== "banned")
    })()

    // Admin/Owner/SuperAdmin see all members
    if (canSeeAllMembers) return deduped

    // Managers / Super Managers: server returns visible list (subtree + upline read-only + org pool)
    if (!currentMemberId) return []
    return deduped
  }, [members, canSeeAllMembers, currentMemberId])

  const isMemberManageable = (member: Member) => manageableMemberIds.has(member.id)

  const activeFilterCount = memberFilters.roles.length + memberFilters.projectIds.length

  const showListSkeleton =
    activeTab === "members"
      ? membersLoading && members.length === 0
      : invitesLoading && invites.length === 0

  const membersInViewerTree = useMemo(() => {
    if (canSeeAllMembers || scopedVisibleIds.size === 0) return visibleMembers
    return visibleMembers.filter((member) => scopedVisibleIds.has(member.id))
  }, [visibleMembers, canSeeAllMembers, scopedVisibleIds])

  const organizationScopedMembers = useMemo(() => {
    if (!canToggleMyTeam || !myTeamOnly) return membersInViewerTree
    if (teamMemberIdsLoading) return membersInViewerTree
    if (teamMemberIds.size === 0) return []
    return membersInViewerTree.filter((member) => teamMemberIds.has(member.id))
  }, [membersInViewerTree, canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading])

  const membersForRoleFilters = useMemo(() => {
    if (canToggleMyTeam && myTeamOnly) return organizationScopedMembers
    return membersInViewerTree
  }, [canToggleMyTeam, myTeamOnly, organizationScopedMembers, membersInViewerTree])

  const roleFilterOptions = useMemo(() => {
    const roles = new Set<string>()
    for (const member of membersForRoleFilters) {
      const displayRole = member.role === "User" ? "Viewer" : (member.role_name || member.role || "")
      if (displayRole) roles.add(displayRole)
    }
    return [...roles].sort((a, b) => roleSortKey(b) - roleSortKey(a))
  }, [membersForRoleFilters])

  const filteredMembers = useMemo(
    () => organizationScopedMembers.filter((member) => memberMatchesFilters(member, memberFilters)),
    [organizationScopedMembers, memberFilters],
  )

  // Pending email invites only — share links and joined members are excluded.
  const visibleInvites = useMemo(() => {
    const pending = invites.filter(
      (invite) => invite.status !== "Joined" && invite.inviteKind !== "open_link",
    )
    if (canSeeAllMembers) return pending
    // Non-admins: API already scopes invites; show all returned pending invites.
    return pending
  }, [invites, canSeeAllMembers])

  const showMembersSelectColumn = canManageMembers && canUseBatchMemberActions
  const showMembersActionsColumn = canManageMembers || isLimitedSelfManageRole(viewerRole)
  const membersTableAreaRef = useRef<HTMLDivElement>(null)
  const membersTableFixedWidth = getMembersTableFixedWidth({
    showSelectColumn: showMembersSelectColumn,
    showActionsColumn: showMembersActionsColumn,
    includeRoleColumn: effectiveEnabledCols.has("role"),
  })
  const autoHiddenMemberCols = useAutoHiddenTableColumns(
    membersTableAreaRef,
    effectiveEnabledCols,
    colOrder,
    MEMBER_COL_AUTO_HIDE_PRIORITY,
    MEMBER_COL_MIN_WIDTH,
    membersTableFixedWidth,
    ["role"],
  )

  const skeletonMemberColumnKeys = useMemo(
    () => colOrder.filter((key) => effectiveEnabledCols.has(key) && !autoHiddenMemberCols.has(key)),
    [colOrder, effectiveEnabledCols, autoHiddenMemberCols],
  )

  useEffect(() => {
    setSelectedMembers((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((id) => manageableMemberIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [manageableMemberIds])

  useEffect(() => {
    if (!canManageMembers) setActiveTab("members")
  }, [canManageMembers])

  useEffect(() => {
    setSelectedMembers(new Set())
    setSelectedInvites(new Set())
  }, [activeTab])

  async function handleBatchModalConfirm(payload: {
    action: BatchEditAction
    payBill?: { payRate?: string; currency?: string; payPeriod?: string }
    workLimits?: { weeklyLimit?: string; dailyLimit?: string; workDays?: number[]; makeupDays?: number[] }
  }) {
    if (payload.action === "removeFromTree") {
      const count = selectedMembers.size
      await handleBatchRemoveFromTree(Array.from(selectedMembers))
      setSelectedMembers(new Set())
      setAddMembersToast({
        title: "Batch actions",
        tone: "info",
        message: `Removed ${count} member${count === 1 ? "" : "s"} from the tree.`,
      })
      return
    }
    if (payload.action === "remove") {
      const count = selectedMembers.size
      await handleRemoveMembers(Array.from(selectedMembers))
      setSelectedMembers(new Set())
      setAddMembersToast({
        title: "Batch actions",
        tone: "info",
        message: `Removed ${count} member${count === 1 ? "" : "s"}.`,
      })
      return
    }
    const patch = {
      ...(payload.payBill ? { payBill: payload.payBill } : {}),
      ...(payload.workLimits ? { workLimits: payload.workLimits } : {}),
    }
    const count = selectedMembers.size
    await handleBatchUpdateMembers(Array.from(selectedMembers), patch)
    setSelectedMembers(new Set())
    setAddMembersToast({
      title: "Batch actions",
      tone: "info",
      message: `Updated ${count} member${count === 1 ? "" : "s"}.`,
    })
  }

  function rowAllowedEntriesFor(member: Member): MemberEntryAction[] {
    const isSelf = isSameMember(member, currentMemberRecord?.id, currentUid, currentEmail)

    if (isLimitedSelfManageRole(viewerRole)) {
      return isSelf ? ["edit-info"] : []
    }

    const canManageThisMember = isMemberManageable(member)

    if (canManageThisMember) {
      const entries: MemberEntryAction[] = [
        "edit-info",
        "edit-role",
        "edit-payment",
        "edit-limits",
        "disable-tracking",
        "reset-password",
      ]
      const displayRole = member.role === "User" ? "Viewer" : member.role
      if (!isOwnerRoleName(displayRole)) {
        if (canRemoveMemberFromTree) {
          entries.push("remove-from-tree")
        }
        entries.push("remove-member")
      }
      return entries
    }

    if (isSelf) {
      return ["edit-info"]
    }
    return []
  }

  return (
    <>
      <motion.div className="flex h-full min-h-0 flex-col overflow-hidden">
      <motion.div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        {canManageMembers && (
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("members")}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl transition-all shadow-sm",
                  activeTab === "members"
                    ? "border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                    : "border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white"
                )} type="button"
              >
                <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Members
                <span className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                  activeTab === "members"
                    ? "bg-emerald-200/80 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200"
                    : "bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300"
                )}>{filteredMembers.length}</span>
              </button>
              <button
                onClick={() => setActiveTab("invites")}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl transition-all shadow-sm",
                  activeTab === "invites"
                    ? "border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                    : "border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white"
                )} type="button"
              >
                <UserPlus className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                Invites
                <span className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                  activeTab === "invites"
                    ? "bg-emerald-200/80 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200"
                    : "bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300"
                )}>{visibleInvites.length}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowOnboarding(true)}
                className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80" type="button"
              >
                <Check className="h-4 w-4 text-emerald-500" />
                Onboarding
              </button>
              {canViewMembersTree && (
                <button
                  onClick={() => onNavigate?.("people-members-tree")}
                  className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80" type="button"
                >
                  <Network className="h-4 w-4 text-indigo-500" />
                  Members tree
                </button>
              )}
              {canManageMemberBans && (
                <button
                  onClick={() => onNavigate?.("people-member-bans")}
                  className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80" type="button"
                >
                  <ShieldBan className="h-4 w-4 text-rose-500" />
                  Banned members
                </button>
              )}
              <button
                onClick={() => setShowFilters(true)}
                className="relative flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80"
                type="button"
              >
                <SlidersHorizontal className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {canCreateTransferRequests && (
                <button
                  onClick={() => setShowRecruit(true)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80"
                  type="button"
                >
                  <Users className="h-4 w-4 text-amber-500" />
                  Recruit member
                </button>
              )}
              <button
                onClick={() => {
                  addMembersInstanceRef.current += 1
                  setShowAdd(true)
                }}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02] hover:shadow-emerald-600/30 active:scale-95 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400" type="button"
              >
                <UserPlus className="h-4 w-4" />
                Add members
              </button>
            </div>
          </div>
        )}

        <motion.div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3">
            {!canManageMembers && (
              <button
                onClick={() => setActiveTab("members")}
                className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold", t.tabActive)} type="button"
              >
                <Users className="h-4 w-4" />
                Members
                <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs", t.tabBadge)}>{filteredMembers.length}</span>
              </button>
            )}
            <div className={cn("relative flex-1 max-w-md rounded-lg border", t.searchWrap)}>
              <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", t.searchIcon)} aria-label="Interactive control" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeTab === "invites" ? "Search invites..." : "Search members..."}
                className={cn("w-full bg-transparent pl-10 pr-4 py-2 text-sm focus:outline-none", t.searchInput)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === "members" && canUseBatchMemberActions && (
              <BatchActionsDropdown
                disabled={selectedMembers.size === 0}
                selectedIds={Array.from(selectedMembers)}
                onOpenAction={setBatchAction}
                onImportClick={() => showMemberImportExportComingSoon("Import")}
                isDark={isDark}
              />
            )}
            {canManageMembers && (
              <>
                <TableToolbarIconButton
                  onClick={() => {
                    if (!MEMBER_IMPORT_EXPORT_ENABLED) {
                      showMemberImportExportComingSoon("Import")
                    }
                  }}
                  title={!MEMBER_IMPORT_EXPORT_ENABLED ? "Import (coming soon)" : "Import"}
                  isDark={isDark}
                  className={!MEMBER_IMPORT_EXPORT_ENABLED ? "cursor-not-allowed opacity-70" : undefined}
                >
                  <Upload className="h-4 w-4" />
                </TableToolbarIconButton>
                <TableToolbarIconButton
                  onClick={() => {
                    if (!MEMBER_IMPORT_EXPORT_ENABLED) {
                      showMemberImportExportComingSoon("Export")
                    }
                  }}
                  title={!MEMBER_IMPORT_EXPORT_ENABLED ? "Export (coming soon)" : "Export"}
                  isDark={isDark}
                  className={!MEMBER_IMPORT_EXPORT_ENABLED ? "cursor-not-allowed opacity-70" : undefined}
                >
                  <Download className="h-4 w-4" />
                </TableToolbarIconButton>
              </>
            )}
            <MyTeamScopeIconButton isDark={isDark} />
            <TableRefreshButton
              onClick={() => void handleRefresh()}
              isRefreshing={isRefreshing}
              isDark={isDark}
            />
            {canManageMembers && (
              <div className="relative">
                <button
                  onClick={() => setShowMemberColPicker((v) => !v)}
                  className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors", isDark ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")} type="button"
                >
                  <Table2 className="h-4 w-4" />
                  Columns
                </button>
                {showMemberColPicker && (
                  <>
                    <div className="fixed inset-0" onClick={() => setShowMemberColPicker(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
                    <div className={cn("absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border py-2 shadow-xl", t.dropdown)}>
                      <div className={cn("px-3 py-1.5 text-xs font-semibold uppercase tracking-wider", t.dropdownHeader)}>
                        Show columns
                      </div>
                      {ALL_MEMBER_COLS.map((col) => (
                        <button
                          key={col.key}
                          onClick={() => toggleMemberCol(col.key)}
                          className={cn(
                            "flex w-full items-center justify-between px-3 py-2 text-sm transition-colors",
                            enabledCols.has(col.key)
                              ? isDark ? "text-[#dce1fb] hover:bg-[#2e3447]" : "text-slate-800 hover:bg-slate-50"
                              : isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-400 hover:bg-slate-50"
                          )} type="button"
                        >
                          {col.label}
                          {enabledCols.has(col.key) && <Check className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>

        <div ref={membersTableAreaRef} className="flex min-h-0 flex-1 flex-col">
          {showListSkeleton ? (
            activeTab === "members" ? (
              <MembersSkeleton
                isDark={isDark}
                rowCount={MEMBERS_TABLE_ROWS_PER_PAGE}
                maxRowsPerPage={tableRowCap}
                fillHeight
                showSelectColumn={showMembersSelectColumn}
                showActionsColumn={showMembersActionsColumn}
                columnKeys={skeletonMemberColumnKeys}
              />
            ) : (
              <InvitesSkeleton
                isDark={isDark}
                rowCount={MEMBERS_TABLE_ROWS_PER_PAGE}
                maxRowsPerPage={tableRowCap}
                fillHeight
              />
            )
          ) : activeTab === "members" && membersError && members.length === 0 ? (
            <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center p-6">
              <DashboardStatusContent
                isDark={isDark}
                icon={AlertCircle}
                iconTone="warning"
                title="Couldn't load members"
                description={membersError}
                primaryLabel="Retry"
                primaryIcon={RefreshCw}
                onPrimary={() => void refetchMembersList({ forceRefetch: true, showLoading: true })}
              />
            </div>
          ) : activeTab === "members" ? (
            <div className="flex h-full min-h-0 flex-1 flex-col">
              <MembersTab
                members={filteredMembers}
                onRemoveMember={handleRemoveMember}
                onRemoveFromTree={handleRemoveFromTree}
                onPatchMember={handlePatchMember}
                onSaveProfile={handleSaveProfile}
                onNavigate={onNavigate}
                enabledCols={effectiveEnabledCols}
                loadingCols={loadingCols}
                autoHiddenCols={autoHiddenMemberCols}
                selected={selectedMembers}
                setSelected={setSelectedMembers}
                search={search}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                colOrder={colOrder}
                draggedCol={draggedCol}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                canManage={canManageMembers}
                showActionsColumn={showMembersActionsColumn}
                enableBatchSelect={canUseBatchMemberActions}
                isRowManageable={isMemberManageable}
                getRowAllowedEntries={rowAllowedEntriesFor}
                actorRole={memberRole}
                isDark={isDark}
                currentUserMemberId={currentMemberRecord?.id}
                rowsPerPage={MEMBERS_TABLE_ROWS_PER_PAGE}
                maxRowsPerPage={tableRowCap}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-1 flex-col">
              <InvitesTab
                invites={visibleInvites}
                search={search}
                selected={selectedInvites}
                setSelected={setSelectedInvites}
                onPatchInvite={handlePatchInvite}
                onRemoveInvite={handleRemoveInvite}
                onResendInvite={handleResendInvite}
                onCopyInviteLink={handleCopyInviteLink}
                onRenewInvite={handleRenewInvite}
                onActionMessage={({ tone, message }) =>
                  setAddMembersToast({ title: "Invites", tone, message })
                }
                onNavigate={onNavigate}
                sortCol={inviteSortCol}
                sortDir={inviteSortDir}
                onSort={handleInviteSort}
                colOrder={inviteColOrder}
                draggedCol={draggedInviteCol}
                onDragStart={handleInviteDragStart}
                onDragOver={handleInviteDragOver}
                onDrop={handleInviteDrop}
                onDragEnd={handleInviteDragEnd}
                isDark={isDark}
                rowsPerPage={MEMBERS_TABLE_ROWS_PER_PAGE}
                maxRowsPerPage={tableRowCap}
              />
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showAdd && (
          <AddMembersModal
            key={`add-members-${addMembersInstanceRef.current}`}
            onClose={() => setShowAdd(false)}
            onAdd={handleAddMembers}
            onShareLink={handleCreateShareLink}
            onPending={(payload) => {
              const pending = formatAddMembersPending(payload)
              setAddMembersToast({ ...pending, tone: "info" })
            }}
            onSuccess={(result) => {
              const formatted = formatAddMembersSuccess(result)
              const inviteUrls =
                result.mode === "invites" ? result.inviteUrls.map((url) => resolveInviteUrl(url)).filter(Boolean) : []
              setAddMembersToast({
                title: "Add members",
                ...formatted,
                ...(inviteUrls.length ? { inviteUrls } : {}),
              })
            }}
            onError={(message) => {
              setAddMembersToast({
                title: "Add members",
                tone: "error",
                message,
              })
            }}
          />
        )}
        {showRecruit && (
          <RecruitMemberModal
            key="recruit-member"
            open={showRecruit}
            onClose={() => setShowRecruit(false)}
            onSuccess={({ transferUrl, email }) => {
              setAddMembersToast({
                title: "Recruit member",
                tone: "info",
                message: `Invitation sent to ${email}.`,
                inviteUrls: [transferUrl],
              })
            }}
          />
        )}
        {showOnboarding && (
          <OnboardingModal key="onboarding" onClose={() => setShowOnboarding(false)} />
        )}
        {batchAction !== null && (
          <BatchEditModal
            key="batch-edit"
            open
            action={batchAction}
            members={filteredMembers}
            selectedIds={Array.from(selectedMembers)}
            isDark={isDark}
            onClose={() => setBatchAction(null)}
            onConfirm={handleBatchModalConfirm}
          />
        )}
        {showFilters && (
          <MemberFiltersPanel
            key="member-filters"
            onClose={() => setShowFilters(false)}
            onApply={setMemberFilters}
            onClear={() => setMemberFilters(EMPTY_MEMBER_FILTERS)}
            initialFilters={memberFilters}
            roleOptions={roleFilterOptions}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
      <NotifyToastHost
        message={addMembersToast?.message ?? null}
        title={addMembersToast?.title ?? "Add members"}
        tone={addMembersToast?.tone ?? "info"}
        onDismiss={() => setAddMembersToast(null)}
      />
      {addMembersToast?.inviteUrls?.length ? (
        <div className="fixed bottom-4 right-4 z-221 flex w-[min(calc(100vw-2rem),22rem)] flex-col gap-2 pointer-events-none">
          <button
            type="button"
            className="pointer-events-auto ml-auto rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-blue-700"
            onClick={() => {
              void copyTextToClipboard(addMembersToast.inviteUrls!.join("\n"))
            }}
          >
            Copy invite link{addMembersToast.inviteUrls.length > 1 ? "s" : ""}
          </button>
        </div>
      ) : null}
    </motion.div>
    </>
  )
}
