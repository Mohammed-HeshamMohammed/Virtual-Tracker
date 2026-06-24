"use client"

import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight, Download, FolderKanban, RefreshCw, Search } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { ActivityMemberSelect } from "@/features/activity/components/activity-member-select"
import {
  ActivityToolbarDivider,
  ActivityToolbarIconButton,
  ActivityToolbarTextButton,
} from "@/features/activity/components/activity-toolbar-primitives"
import { MyTeamScopeTextButton } from "@/features/members/components/my-team-scope-controls"
import { ActivityToolbarSecondaryRow } from "@/features/activity/components/activity-toolbar-secondary"
import type { ActivitySubPage } from "@/features/activity/components/activity-shell-context"

interface ActivityControlBarProps {
  pageId: ActivitySubPage
  selectedDay: Date
  selectedDayLabel: string
  isAllDays: boolean
  isSelectedToday: boolean
  isYesterday: boolean
  showDayPicker: boolean
  onCloseDayPicker: () => void
  onSelectDay: (day: Date) => void
  onSelectAllDays: () => void
  onGoToToday: () => void
  onGoToYesterday: () => void
  onOpenDayPicker: () => void
  onShiftDay: (delta: number) => void
  searchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onResetFilters: () => void
  hasActiveFilters: boolean
  searchPlaceholder: string
  onRefresh: () => void
  onExport?: () => void
  canFilterByProject?: boolean
  projectScopeOnly?: boolean
  onToggleProjectScope?: () => void
  scopeLoading?: boolean
  memberLabel?: string | null
  pageFilters?: ReactNode
}

export function ActivityControlBar({
  pageId,
  selectedDay,
  selectedDayLabel,
  isAllDays,
  isSelectedToday,
  isYesterday,
  showDayPicker,
  onCloseDayPicker,
  onSelectDay,
  onSelectAllDays,
  onGoToToday,
  onGoToYesterday,
  onOpenDayPicker,
  onShiftDay,
  searchQuery,
  onSearchChange,
  onClearSearch,
  onResetFilters,
  hasActiveFilters,
  searchPlaceholder,
  onRefresh,
  onExport,
  canFilterByProject,
  projectScopeOnly,
  onToggleProjectScope,
  scopeLoading,
  memberLabel,
  pageFilters,
}: ActivityControlBarProps) {
  return (
    <div className="overflow-visible rounded-xl border border-slate-100 bg-white p-3 shadow-sm sm:p-3.5">
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        <div
          className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5"
          role="group"
          aria-label="Day navigation"
        >
          <button
            type="button"
            onClick={() => onShiftDay(-1)}
            disabled={isAllDays}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white disabled:opacity-30"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div
            className={cn(
              "flex h-8 min-w-[5.5rem] items-center justify-center px-3 text-xs font-medium sm:min-w-[6.5rem] sm:text-sm",
              isAllDays ? "text-emerald-700" : "text-slate-700",
            )}
            aria-live="polite"
          >
            {selectedDayLabel}
          </div>
          <button
            type="button"
            onClick={() => onShiftDay(1)}
            disabled={isAllDays || isSelectedToday}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white disabled:opacity-30"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <ActivityToolbarDivider />

        <ActivityMemberSelect compact />

        <div className="relative min-w-0 flex-1 basis-full sm:basis-48 sm:min-w-[11rem]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-700 transition-colors placeholder:text-slate-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>

        <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:ml-auto sm:w-auto">
          {canFilterByProject && onToggleProjectScope ? (
            <ActivityToolbarTextButton
              onClick={onToggleProjectScope}
              disabled={scopeLoading}
              title={projectScopeOnly ? "Only my projects" : "All projects"}
              ariaLabel={projectScopeOnly ? "Only my projects (on)" : "All projects (off)"}
              ariaPressed={projectScopeOnly}
              active={projectScopeOnly}
            >
              <span className="inline-flex items-center gap-1.5">
                <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{projectScopeOnly ? "My projects" : "All projects"}</span>
                <span className="sm:hidden">{projectScopeOnly ? "Mine" : "All"}</span>
              </span>
            </ActivityToolbarTextButton>
          ) : null}

          <MyTeamScopeTextButton />

          {onExport ? (
            <ActivityToolbarIconButton onClick={onExport} title="Export" ariaLabel="Export data" tooltipPlacement="top">
              <Download className="h-4 w-4" />
            </ActivityToolbarIconButton>
          ) : null}

          <ActivityToolbarIconButton onClick={onRefresh} title="Refresh" ariaLabel="Refresh data" tooltipPlacement="top">
            <RefreshCw className="h-4 w-4" />
          </ActivityToolbarIconButton>
        </div>
      </div>

      <ActivityToolbarSecondaryRow
        pageId={pageId}
        isAllDays={isAllDays}
        isToday={!isAllDays && isSelectedToday}
        isYesterday={!isAllDays && isYesterday}
        periodLabel={isAllDays ? "All days" : selectedDayLabel}
        selectedDay={selectedDay}
        showDayPicker={showDayPicker}
        onSelectDay={onSelectDay}
        onCloseDayPicker={onCloseDayPicker}
        onGoToToday={onGoToToday}
        onGoToYesterday={onGoToYesterday}
        onSelectAllDays={onSelectAllDays}
        onOpenDayPicker={onOpenDayPicker}
        searchQuery={searchQuery}
        onClearSearch={onClearSearch}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={onResetFilters}
        memberLabel={memberLabel}
        pageFilters={pageFilters}
      />
    </div>
  )
}
