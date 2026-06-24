"use client"

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowDownAZ, Clock, Grid3X3, List, Shield } from "lucide-react"
import { useAuth } from "@/shared/providers/app"
import { canExportActivity } from "@/features/auth"
import { ActivityControlBar } from "@/features/activity/components/activity-control-bar"
import { ActivityShellProvider, type ActivitySubPage, useActivityShell } from "@/features/activity/components/activity-shell-context"
import { useActivityFeedContext } from "@/features/activity/components/activity-feed-context"
import {
  ActivityCategoryFilter,
  ActivitySegmentedControl,
  ActivityToolbarIconButton,
} from "@/features/activity/components/activity-toolbar-primitives"
import { isYesterdayDay } from "@/features/activity/components/activity-toolbar-secondary"
import { usePeopleTeamScope } from "@/features/members/context/people-team-scope-context"

function ActivityPageFilters() {
  const {
    pageId,
    selectedCategory,
    setSelectedCategory,
    viewMode,
    setViewMode,
    showBlocked,
    setShowBlocked,
    sortOrder,
    setSortOrder,
  } = useActivityShell()

  if (pageId === "activity-apps" || pageId === "activity-urls") {
    return (
      <>
        <ActivityCategoryFilter value={selectedCategory} onChange={setSelectedCategory} />
        <ActivitySegmentedControl
          value={sortOrder}
          onChange={setSortOrder}
          ariaLabel="Sort order"
          options={[
            { value: "time" as const, label: "By time", icon: Clock },
            { value: "name" as const, label: "By name", icon: ArrowDownAZ },
          ]}
        />
        {pageId === "activity-urls" ? (
          <ActivityToolbarIconButton
            onClick={() => setShowBlocked(!showBlocked)}
            title="Show blocked sites only"
            ariaLabel="Show blocked sites only"
            ariaPressed={showBlocked}
            active={showBlocked}
            activeClassName="border-red-200 bg-red-50 text-red-600"
          >
            <Shield className="h-4 w-4" />
          </ActivityToolbarIconButton>
        ) : null}
      </>
    )
  }

  if (pageId === "activity-screenshots") {
    return (
      <>
        <ActivitySegmentedControl
          value={viewMode}
          onChange={setViewMode}
          ariaLabel="Screenshot view mode"
          options={[
            { value: "grid", label: "Grid", icon: Grid3X3 },
            { value: "list", label: "List", icon: List },
          ]}
        />
        <ActivitySegmentedControl
          value={sortOrder}
          onChange={setSortOrder}
          ariaLabel="Sort order"
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ]}
        />
      </>
    )
  }

  return null
}

function ActivityShellStickyBar() {
  const { memberRole } = useAuth()
  const canExport = canExportActivity(memberRole)
  const {
    pageId,
    day,
    searchQuery,
    setSearchQuery,
    searchPlaceholder,
    showExport,
    triggerRefresh,
    triggerExport,
    selectedCategory,
    viewMode,
    showBlocked,
    sortOrder,
    resetPageFilters,
  } = useActivityShell()

  const {
    canFilterByProject,
    projectScopeOnly,
    setProjectScopeOnly,
    scopeLoading,
    scope,
    selectedMemberId,
    clearAllCache,
  } = useActivityFeedContext()

  const { myTeamOnly, refreshTeamMemberIds } = usePeopleTeamScope()

  const prevMyTeamOnlyRef = useRef(myTeamOnly)
  useEffect(() => {
    if (prevMyTeamOnlyRef.current === myTeamOnly) return
    prevMyTeamOnlyRef.current = myTeamOnly
    clearAllCache()
    window.dispatchEvent(new Event("vt-activity-feed-invalidate"))
  }, [myTeamOnly, clearAllCache])

  const pageFilters = useMemo(() => <ActivityPageFilters />, [])

  const memberLabel = useMemo(() => {
    if (selectedMemberId === "all") return null
    const member = scope?.members.find((m) => m.id === selectedMemberId)
    return member ? member.name : null
  }, [scope?.members, selectedMemberId])

  const hasActiveFilters = useMemo(() => {
    if (searchQuery.trim()) return true
    if (selectedCategory !== "all") return true
    if (showBlocked) return true
    if (viewMode !== "grid") return true
    if (sortOrder !== "newest" && sortOrder !== "time") return true
    if (projectScopeOnly) return true
    return false
  }, [searchQuery, selectedCategory, showBlocked, viewMode, sortOrder, projectScopeOnly])

  const handleResetFilters = useCallback(() => {
    resetPageFilters()
    if (projectScopeOnly) setProjectScopeOnly(false)
  }, [resetPageFilters, projectScopeOnly, setProjectScopeOnly])

  const handleRefresh = useCallback(() => {
    triggerRefresh()
    void refreshTeamMemberIds()
  }, [triggerRefresh, refreshTeamMemberIds])

  return (
    <div className="sticky top-0 z-30 -mx-1 shrink-0 overflow-visible bg-white/95 px-1 pb-3 pt-0 backdrop-blur-md supports-backdrop-filter:bg-white/80">
      <ActivityControlBar
        pageId={pageId}
        selectedDay={day.selectedDay}
        selectedDayLabel={day.selectedDayLabel}
        isAllDays={day.dayMode === "all"}
        isSelectedToday={day.isSelectedToday}
        isYesterday={isYesterdayDay(day.selectedDay)}
        showDayPicker={day.showDayPicker}
        onCloseDayPicker={() => day.setShowDayPicker(false)}
        onSelectDay={day.setSelectedDay}
        onSelectAllDays={day.setAllDays}
        onGoToToday={day.goToToday}
        onGoToYesterday={day.goToYesterday}
        onOpenDayPicker={day.openDayPicker}
        onShiftDay={day.shiftSelectedDay}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClearSearch={() => setSearchQuery("")}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
        searchPlaceholder={searchPlaceholder}
        onRefresh={handleRefresh}
        onExport={showExport && canExport ? triggerExport : undefined}
        canFilterByProject={canFilterByProject}
        projectScopeOnly={projectScopeOnly}
        onToggleProjectScope={() => setProjectScopeOnly(!projectScopeOnly)}
        scopeLoading={scopeLoading}
        memberLabel={memberLabel}
        pageFilters={pageFilters}
      />
    </div>
  )
}

function ActivityShellBody({ pageId, children }: { pageId: ActivitySubPage; children: ReactNode }) {
  return (
    <div className="w-full">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pageId}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="space-y-6 py-4 sm:py-6"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function ActivityShell({
  pageId,
  children,
}: {
  pageId: ActivitySubPage
  children: ReactNode
}) {
  const normalizedPage: ActivitySubPage =
    pageId === "activity-apps" || pageId === "activity-urls" ? pageId : "activity-screenshots"

  return (
    <ActivityShellProvider pageId={normalizedPage}>
      <div className="-mt-2 w-full">
        <ActivityShellStickyBar />
        <ActivityShellBody pageId={normalizedPage}>{children}</ActivityShellBody>
      </div>
    </ActivityShellProvider>
  )
}

export type { ActivitySubPage } from "@/features/activity/components/activity-shell-context"
