"use client"

import { useMemo, useState as useComponentState } from "react"
import { AnimatePresence } from "framer-motion"
import { FolderOpen } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import {
  fetchEnrichedProjects,
  type EnrichedProjectListContext,
} from "@/infrastructure/api"
import { useAuth } from "@/shared/providers/app"
import { normalizeMemberRole, canManageProjects } from "@/features/auth"
import { usePageSearch } from "@/shared/ui/layout"
import { useTheme } from "@/shared/providers/app"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"
import { TEAMS_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { useResponsivePageSearch } from "@/shared/tables/ui/responsive-page-search"
import { useCachedList } from "@/features/members/hooks"
import { ProjectsSkeleton } from "@/features/projects/components/skeletons/projects-skeleton"
import { ProjectsTab } from "@/features/projects/components/tables/projects-tab"
import type { ProjectListItem as Project } from "@/features/projects/models/list"
import type { ProjectType } from "@/features/projects/api/project-api"

// Custom hooks, components & modal
import { useProjectColumns } from "@/features/projects/hooks/use-project-columns"
import { useProjectMutations } from "@/features/projects/hooks/use-project-mutations"
import { ProjectModal } from "@/features/projects/components/modals/project-modal"
import { ProjectsToolbar } from "@/features/projects/components/projects-toolbar"
import { DeleteConfirmDialog } from "@/features/projects/ui-components"

const PROJECT_COLOR_POOL = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#0ea5e9"]

function mapApiProject(
  p: {
    id: string
    name: string
    status: string
    type?: ProjectType
  },
  idx: number,
  ctx: EnrichedProjectListContext,
): Project {
  const id = p.id || `project-${idx}`
  const budgetRow = ctx.budgetsByProject.get(id)
  const teams = ctx.teamNamesByProject.get(id) ?? []
  const members = ctx.memberCountByProject.get(id) ?? 0
  const memberLimit = ctx.memberLimitByProject.get(id) ?? null
  const type = p.type === "calling" ? "calling" : "normal"

  return {
    id,
    name: p.name || `Project ${idx + 1}`,
    type,
    color: PROJECT_COLOR_POOL[idx % PROJECT_COLOR_POOL.length]!,
    status: p.status === "archived" ? "archived" : "active",
    teams,
    members,
    memberLimit,
    // Real counts from the server-side aggregate. Calling projects have no
    // tasks at all, so they get null rather than a misleading 0/0.
    todos: type === "calling" ? null : ctx.taskCountsByProject.get(id) ?? { done: 0, total: 0 },
    // spent is now real - computed server-side from tracked time x rate
    // (see computeProjectSpentPg in Dashboard-Backend), not fabricated.
    budget: budgetRow
      ? {
        spent: budgetRow.spent ?? 0,
        // target is the real total: for scope='per_person' rows `cost` is
        // hours-per-member, not a total. `cost` is only correct here for
        // scope='per_project', where target already equals cost.
        total: budgetRow.target ?? budgetRow.cost,
        type: budgetRow.type === "Hours based" ? "hours" : "cost",
      }
      : null,
    memberIds: ctx.memberIdsByProject.get(id) ?? [],
  }
}

async function fetchProjectsForPage(): Promise<Project[]> {
  const { projects: rows, context } = await fetchEnrichedProjects()
  return rows.map((p, idx) => mapApiProject(p, idx, context))
}

export function ProjectsPage() {
  const { isDark } = useTheme()
  const t = isDark ? dark : light
  const { user, memberId: currentMemberId, memberRole } = useAuth()
  const normalizedRole = normalizeMemberRole(memberRole)
  const canManage = canManageProjects(memberRole)
  const [tab, setTab] = useComponentState<"active" | "archived">("active")
  const { query: search, setQuery: setSearch } = usePageSearch()

  const { toolbarRef, compact: compactSearch, expanded: searchExpanded, setExpanded: setSearchExpanded } =
    useResponsivePageSearch()
  const searchTheme = { searchWrap: t.searchWrap, searchIcon: t.searchIcon, searchInput: t.searchInput }
  const hasSearchQuery = search.trim().length > 0
  const showCompactSearchRow = compactSearch && searchExpanded
  const [selected, setSelected] = useComponentState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useComponentState(false)
  const [batchBusy, setBatchBusy] = useComponentState(false)
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useComponentState(false)

  const [isAddOpen, setIsAddOpen] = useComponentState(false)
  const [editingProjectId, setEditingProjectId] = useComponentState<string | null>(null)

  // Columns Hook
  const {
    enabledCols,
    colOrder,
    sortCol,
    sortDir,
    draggedCol,
    showColPicker,
    setShowColPicker,
    toggleProjectCol,
    handleSort,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = useProjectColumns()

  const {
    data,
    isLoading,
    refetch: refetchProjects,
    setData: setProjects,
  } = useCachedList<Project[]>({
    cacheKey: "pm-projects:projects",
    fetch: fetchProjectsForPage,
    onError: (err) => console.error("Failed to fetch projects:", err),
    staleMs: 300_000,
    minLoadingMs: 0,
  })

  // Mutations Hook
  const {
    archiveProject,
    deleteProject,
    saveProject,
    batchArchive,
    batchDelete,
  } = useProjectMutations({
    data,
    refetchProjects,
    setProjects,
    setSelected,
    user,
    memberId: currentMemberId,
    canManageProjects: canManage,
  })

  function closeProjectModal() {
    setIsAddOpen(false)
    setEditingProjectId(null)
  }

  function openAddProjectModal() {
    if (!canManage) return
    setEditingProjectId(null)
    setIsAddOpen(true)
  }

  function openEditProject(id: string) {
    if (!canManage) return
    setEditingProjectId(id)
    setIsAddOpen(true)
  }

  const projectList = useMemo(() => {
    const privilegedRoles = new Set(["owner", "superadmin", "admin"])
    if (privilegedRoles.has(normalizedRole)) return data
    if (!currentMemberId) return data
    return data.filter((p: Project) => p.memberIds.includes(currentMemberId))
  }, [data, normalizedRole, currentMemberId])

  const tabProjects = useMemo(() => projectList.filter((p) => p.status === tab), [projectList, tab])

  const searchFiltered = useMemo(() => {
    const q = search.toLowerCase()
    return tabProjects.filter((p) => {
      const name = p.name.toLowerCase()
      const teams = (p.teams || []).join(" ").toLowerCase()
      return name.includes(q) || teams.includes(q)
    })
  }, [tabProjects, search])

  const counts = useMemo(() => ({
    active: projectList.filter((p) => p.status === "active").length,
    archived: projectList.filter((p) => p.status === "archived").length,
  }), [projectList])

  const selectedIdsInView = useMemo(
    () => searchFiltered.filter((p) => selected.has(p.id)).map((p) => p.id),
    [searchFiltered, selected],
  )
  const selectedInView = selectedIdsInView.length
  const showListSkeleton = isLoading && data.length === 0

  async function handleBatchArchive() {
    if (selectedIdsInView.length === 0 || batchBusy) return
    setBatchBusy(true)
    try {
      await batchArchive(selectedIdsInView)
    } finally {
      setBatchBusy(false)
    }
  }

  function handleBatchDeleteRequest() {
    if (selectedIdsInView.length === 0) return
    setBatchDeleteConfirmOpen(true)
  }

  async function handleBatchDeleteConfirm() {
    if (selectedIdsInView.length === 0 || batchBusy) return
    setBatchBusy(true)
    try {
      await batchDelete(selectedIdsInView)
    } finally {
      setBatchBusy(false)
      setBatchDeleteConfirmOpen(false)
    }
  }

  const projectsEmptyContent = (
    <>
      <div
        className={cn(
          "mb-2 flex h-10 w-10 items-center justify-center rounded-full",
          isDark ? "bg-[#191f31]" : "bg-slate-100",
        )}
      >
        <FolderOpen className={cn("h-5 w-5", isDark ? "text-[#3d4a3d]" : "text-slate-300")} />
      </div>
      <p className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        {search ? `No ${tab} projects matching "${search}"` : `No ${tab} projects yet`}
      </p>
      {!search && tab === "active" && canManage ? (
        <button
          type="button"
          onClick={openAddProjectModal}
          className={cn("mt-2 text-sm font-medium hover:underline", isDark ? "text-[#4be277]" : "text-blue-500")}
        >
          + Add project
        </button>
      ) : null}
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <ProjectsToolbar
          tab={tab}
          setTab={setTab}
          setSelected={setSelected}
          setSearch={setSearch}
          search={search}
          compactSearch={compactSearch}
          searchExpanded={searchExpanded}
          setSearchExpanded={setSearchExpanded}
          searchTheme={searchTheme}
          isDark={isDark}
          counts={counts}
          showColPicker={showColPicker}
          setShowColPicker={setShowColPicker}
          toggleProjectCol={toggleProjectCol}
          enabledCols={enabledCols}
          selectedInView={selectedInView}
          batchOpen={batchOpen}
          setBatchOpen={setBatchOpen}
          onBatchArchive={handleBatchArchive}
          onBatchDelete={handleBatchDeleteRequest}
          batchBusy={batchBusy}
          openAddProjectModal={openAddProjectModal}
          showCompactSearchRow={showCompactSearchRow}
          toolbarRef={toolbarRef}
          canManageProjects={canManage}
          // forceRefetch: true - without it, useCachedList's refetch silently
          // re-applies the cached data and skips the network call whenever
          // it's within staleMs (5min here) of the last fetch, which made
          // this button look broken most of the time it was clicked.
          onRefresh={() => void refetchProjects({ forceRefetch: true })}
          isRefreshing={isLoading}
          t={t}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {showListSkeleton ? (
            <ProjectsSkeleton
              isDark={isDark}
              rowCount={TEAMS_TABLE_ROWS_PER_PAGE}
              fillHeight
              showSelectColumn={canManage}
              showActionsColumn={canManage}
            />
          ) : (
            <ProjectsTab
              projects={tabProjects}
              search={search}
              enabledCols={enabledCols}
              selected={selected}
              setSelected={setSelected}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
              colOrder={colOrder}
              draggedCol={draggedCol}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onEdit={openEditProject}
              onArchive={archiveProject}
              onDelete={deleteProject}
              isDark={isDark}
              canManageProjects={canManage}
              emptyContent={projectsEmptyContent}
            />
          )}
        </div>
      </div>

      <AnimatePresence>
        {isAddOpen && canManage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeProjectModal()
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                closeProjectModal()
              }
            }}
          >
            <ProjectModal
              projectId={editingProjectId}
              user={user}
              onClose={closeProjectModal}
              onSave={saveProject}
            />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        <DeleteConfirmDialog
          deleteConfirmId={batchDeleteConfirmOpen ? "batch" : null}
          onClose={() => setBatchDeleteConfirmOpen(false)}
          onConfirm={() => void handleBatchDeleteConfirm()}
          actionBusy={batchBusy}
          isDark={isDark}
          t={t}
          count={selectedIdsInView.length}
        />
      </AnimatePresence>
    </div>
  )
}
