/* eslint-disable react-doctor/use-lazy-motion, react-doctor/async-await-in-loop, react-doctor/js-set-map-lookups, react-doctor/js-combine-iterations */
/* eslint-disable react-doctor/prefer-module-scope-pure-function */
/* eslint-disable react-doctor/no-giant-component */
"use client"

import { useMemo, useState, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, Plus, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import { useAuth } from "@/shared/providers/app"
import { useMemberScope } from "@/features/members/hooks/use-members-hierarchy"
import { usePageSearch } from "@/shared/ui/layout"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { TEAMS_TABLE_ROWS_PER_PAGE, TEAMS_TABLE_MIN_ROWS, TEAMS_TABLE_MAX_ROWS } from "@/features/members/config/ui-config"
import { useCachedList, usePaginatedTable } from "@/features/members/hooks"
import { PaginatedTableShell, TableRefreshButton, TableScroll, TablePagination } from "@/shared/tables/ui"
import { MyTeamScopeIconButton } from "@/features/members/components/my-team-scope-controls"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"
import { TeamsTable } from "@/features/teams/components/tables"
import { AddTeamModal } from "@/features/teams/components/modals"
import { fetchEnrichedTeams, type EnrichedTeam } from "@/features/teams/services/enrich-teams"
import { canEditTeam, canManageAllTeams, isManagerRole } from "@/features/teams/utils/team-edit-access"
import { TeamsSkeleton } from "@/features/teams/components/skeletons/teams-skeleton"
import {
  createTeam,
  deleteTeam as deleteTeamApi,
  updateTeam,
} from "@/features/teams/api/team-api"
import { validateTeamRoster } from "@/features/teams/validators/validate-team-roster"
import type { TeamWizardSavePayload } from "@/features/teams/components/modals/add-team-modal"
export function TeamsPage() {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { canManageTeams, canSeeAllMembers, manageEmployeeTeams } = usePermissions()
  const { canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading, refreshTeamMemberIds } = usePeopleTeamScope()
  const { memberId, memberRole, sessionReady, isLoggedIn } = useAuth()
  const { visibleMemberIds, manageableMemberIds: scopedManageableIds, teamStaffableMemberIds, refreshScope } = useMemberScope({
    canSeeAllMembers,
    currentMemberId: memberId,
    sessionReady: sessionReady && isLoggedIn,
  })
  const [showModal, setShowModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<EnrichedTeam | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const useTeamStaffablePicker =
    canManageTeams && isManagerRole(memberRole ?? "") && !canManageAllTeams(memberRole ?? "")

  const modalAllowedMemberIds = useMemo(() => {
    if (canSeeAllMembers && myTeamOnly && !teamMemberIdsLoading && teamMemberIds.size > 0) {
      const scoped = new Set(teamMemberIds)
      if (memberId) scoped.add(memberId)
      if (editingTeam) {
        for (const member of editingTeam.members) scoped.add(member.id)
      }
      return scoped
    }

    if (canSeeAllMembers || canManageAllTeams(memberRole ?? "")) return null
    if (useTeamStaffablePicker) return null

    const mergeIds = (...groups: Array<Iterable<string>>) => {
      const out = new Set<string>()
      for (const group of groups) {
        for (const id of group) out.add(id)
      }
      return out
    }

    if (editingTeam && canEditTeam(editingTeam, memberId ?? "", memberRole ?? "")) {
      return mergeIds(
        visibleMemberIds.size > 0 ? visibleMemberIds : scopedManageableIds,
        editingTeam.members.map((m) => m.id),
        memberId ? [memberId] : [],
      )
    }

    if (canManageTeams) {
      if (!editingTeam && isManagerRole(memberRole ?? "")) {
        if (teamStaffableMemberIds.size > 0) return teamStaffableMemberIds
        if (scopedManageableIds.size > 0) return scopedManageableIds
        return memberId ? new Set([memberId]) : new Set<string>()
      }
      if (manageEmployeeTeams && visibleMemberIds.size > 0) return visibleMemberIds
      if (scopedManageableIds.size > 0) return scopedManageableIds
      return memberId ? new Set([memberId]) : new Set<string>()
    }

    if (visibleMemberIds.size > 0) return visibleMemberIds
    return memberId ? new Set([memberId]) : new Set<string>()
  }, [
    canSeeAllMembers,
    editingTeam,
    memberId,
    memberRole,
    canManageTeams,
    manageEmployeeTeams,
    visibleMemberIds,
    scopedManageableIds,
    teamStaffableMemberIds,
    useTeamStaffablePicker,
    myTeamOnly,
    teamMemberIdsLoading,
  ])

  function canUserEditTeam(team: EnrichedTeam): boolean {
    return canEditTeam(team, memberId ?? "", memberRole ?? "")
  }

  const {
    data: teams,
    setData: setTeams,
    isLoading,
    refetch: refetchTeams,
  } = useCachedList<EnrichedTeam[]>({
    cacheKey: "people:teams",
    fetch: fetchEnrichedTeams,
    onError: (err) => console.error("Failed to fetch teams:", err),
    staleMs: 300_000,
    minLoadingMs: 0,
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      refreshScope()
      await Promise.all([
        refetchTeams({ forceRefetch: true, showLoading: false }),
        refreshTeamMemberIds(),
      ])
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, refreshScope, refetchTeams, refreshTeamMemberIds])
  const { query: search, setQuery: setSearch } = usePageSearch()

  const filtered = useMemo(() => {
    let list = teams
    if (canToggleMyTeam && myTeamOnly && !teamMemberIdsLoading && teamMemberIds.size > 0) {
      list = teams.filter((team) => team.members.some((member) => teamMemberIds.has(member.id)))
    }
    return list.filter((team) => team.name.toLowerCase().includes(search.toLowerCase()))
  }, [teams, search, canToggleMyTeam, myTeamOnly, teamMemberIds, teamMemberIdsLoading])

  const tableBodyRef = useRef<HTMLDivElement>(null)
  const { currentPage, setCurrentPage, totalPages, visibleRows: paginatedTeams, fillsRemaining, rowsPerPage } =
    usePaginatedTable(filtered, TEAMS_TABLE_ROWS_PER_PAGE, tableBodyRef, {
      maxRowsPerPage: TEAMS_TABLE_MAX_ROWS,
      minRowsPerPage: TEAMS_TABLE_MIN_ROWS,
    })

  function openCreateTeamModal() {
    if (!canManageTeams) return
    setEditingTeam(null)
    setShowModal(true)
  }

  function openEditTeamModal(team: EnrichedTeam) {
    if (!canUserEditTeam(team)) return
    setEditingTeam(team)
    setShowModal(true)
  }

  function closeTeamModal() {
    setShowModal(false)
    setEditingTeam(null)
  }

  async function saveTeam(teamData: TeamWizardSavePayload) {
    if (editingTeam && !canUserEditTeam(editingTeam)) {
      throw new Error("Only the organization Owner or team leads can edit this team.")
    }
    if (!editingTeam && !canManageTeams) {
      throw new Error("Permission denied")
    }

    const rosterError = validateTeamRoster(teamData.memberIds, teamData.leadIds)
    if (rosterError) {
      throw new Error(rosterError)
    }

    const memberIds = [...new Set(teamData.memberIds)]
    const leadIds = teamData.leadIds.filter((id) => memberIds.includes(id))

    setPageError(null)
    if (editingTeam) {
      await updateTeam(editingTeam.id, {
        name: teamData.name,
        schedule_weekly_report: teamData.schedule_weekly_report,
        member_ids: memberIds,
        lead_ids: leadIds,
        project_ids: teamData.projectIds,
      })
      await refetchTeams({ showLoading: true, forceRefetch: true })
      closeTeamModal()
      return
    }

    await createTeamWithLinks({
      ...teamData,
      memberIds,
      leadIds,
    })
  }

  async function createTeamWithLinks(teamData: TeamWizardSavePayload) {
    await createTeam({
      name: teamData.name,
      schedule_weekly_report: teamData.schedule_weekly_report,
      member_ids: teamData.memberIds,
      lead_ids: teamData.leadIds,
      project_ids: teamData.projectIds,
    })

    await refetchTeams({ showLoading: true, forceRefetch: true })
    closeTeamModal()
  }

  async function deleteTeam(id: string) {
    const team = teams.find((t) => t.id === id)
    if (team && !canUserEditTeam(team)) {
      setPageError("Only the organization Owner or team leads can edit this team.")
      return
    }
    setPageError(null)
    try {
      await deleteTeamApi(id)
      setTeams((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete team"
      setPageError(message)
      console.error("Failed to delete team:", err)
    }
  }

// eslint-disable-next-line react-doctor/js-combine-iterations
  const showListSkeleton = isLoading && teams.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3">
            <button
              className="flex items-center gap-2 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 shadow-sm" type="button"
            >
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Teams
              <span className="ml-1 rounded-full bg-emerald-200/80 dark:bg-emerald-900/80 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">{teams.length}</span>
            </button>
            <div className={cn("relative flex-1 max-w-md rounded-xl border", t.searchWrap)}>
              <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", t.searchIcon)} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams..."
                className={cn("w-full bg-transparent pl-10 pr-4 py-2 text-sm focus:outline-none", t.searchInput)} aria-label="Interactive control"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MyTeamScopeIconButton isDark={isDark} />
            <TableRefreshButton
              onClick={() => void handleRefresh()}
              isRefreshing={isRefreshing}
              isDark={isDark}
            />
            {canManageTeams && (
              <button
                onClick={openCreateTeamModal}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02] hover:shadow-emerald-600/30 active:scale-95 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400" type="button"
              >
                <Plus className="h-4 w-4" />
                Add team
              </button>
            )}
          </div>
        </div>

        {pageError ? (
          <div className={cn("mb-3 rounded-lg border px-4 py-2 text-sm", isDark ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-red-200 bg-red-50 text-red-700")}>
            {pageError}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {showListSkeleton ? (
            <TeamsSkeleton isDark={isDark} rowCount={TEAMS_TABLE_ROWS_PER_PAGE} fillHeight />
          ) : (
            <PaginatedTableShell
              isDark={isDark}
              fillsRemaining={fillsRemaining}
              isEmpty={filtered.length === 0}
              emptyContent={
                <div className="flex flex-col items-center">
                  <div className={cn("mb-2 flex h-10 w-10 items-center justify-center rounded-full", isDark ? "bg-[#191f31]" : "bg-slate-100")}>
                    <Users className={cn("h-5 w-5", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
                  </div>
                  <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    {search ? `No teams matching "${search}"` : canManageTeams ? "No teams yet. Create your first team." : "No teams in your scope."}
                  </p>
                  {!search && canManageTeams && (
                    <button onClick={openCreateTeamModal} className={cn("mt-2 text-sm font-medium hover:underline", isDark ? "text-[#4be277]" : "text-blue-500")} type="button">
                      + Add team
                    </button>
                  )}
                </div>
              }
              footer={
                filtered.length > 0 ? (
                  <TablePagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={filtered.length}
                    rowsPerPage={rowsPerPage}
                    onPageChange={setCurrentPage}
                    isDark={isDark}
                  />
                ) : undefined
              }
            >
              {filtered.length > 0 ? (
                <TableScroll visibleRowCount={paginatedTeams.length} scrollRef={tableBodyRef}>
                  {(rowH) => (
                    <table className="h-full w-full">
                      <thead className={cn("border-b", t.tableBorder, t.tableBg)}>
                        <tr className={t.tableHeader}>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Members</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Projects</th>
                          <th className="w-10 px-2" />
                        </tr>
                      </thead>
                      <tbody className={cn("divide-y", t.tableBorder)}>
                        <TeamsTable
                          teams={paginatedTeams}
                          onEdit={openEditTeamModal}
                          onDelete={deleteTeam}
                          canEditTeam={canUserEditTeam}
                          isDark={isDark}
                          distributedRowHeight={rowH}
                        />
                      </tbody>
                    </table>
                  )}
                </TableScroll>
              ) : null}
            </PaginatedTableShell>
          )}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (editingTeam ? canUserEditTeam(editingTeam) : canManageTeams) && (
          <AddTeamModal
            key={editingTeam?.id ?? "create"}
            mode={editingTeam ? "edit" : "create"}
            initial={
              editingTeam
                ? {
                  name: editingTeam.name,
                  schedule_weekly_report: editingTeam.schedule_weekly_report,
                  memberIds: editingTeam.members.map((m) => m.id),
                  leadIds: editingTeam.members.filter((m) => m.is_lead).map((m) => m.id),
                  projectIds: editingTeam.projects.map((p) => p.id),
                }
                : null
            }
            onClose={closeTeamModal}
            onSave={saveTeam}
            allowedMemberIds={modalAllowedMemberIds}
            useTeamStaffablePicker={useTeamStaffablePicker}
            actorRole={memberRole}
            rosterMembers={editingTeam?.members ?? []}
            rosterProjects={editingTeam?.projects ?? []}
            teamId={editingTeam?.id}
            teamScopeMemberIds={
              canToggleMyTeam && myTeamOnly && !teamMemberIdsLoading ? teamMemberIds : null
            }
          />
        )}
      </AnimatePresence>
    </div>
  )
}
