"use client"

import type { ReactNode } from "react"
import { Calendar, RotateCcw, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { startOfDay } from "@/features/activity/utils/activity-day-utils"
import { ScreenshotDayPickerPopover } from "@/features/activity/components/screenshot-day-picker"
import type { ActivitySubPage } from "@/features/activity/components/activity-shell-context"

function ToolbarChip({
  active,
  onClick,
  children,
  title,
  ariaExpanded,
  ariaHasPopup,
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
  title?: string
  ariaExpanded?: boolean
  ariaHasPopup?: boolean | "dialog"
}) {
  if (!title) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHasPopup}
        className={cn(
          "inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium transition-colors sm:text-sm",
          active
            ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600"
            : "text-slate-500 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-700/60 hover:text-slate-700 dark:hover:text-slate-200",
        )}
      >
        {children}
      </button>
    )
  }

  return (
    <IconTooltip text={title} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHasPopup}
        className={cn(
          "inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium transition-colors sm:text-sm",
          active
            ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600"
            : "text-slate-500 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-700/60 hover:text-slate-700 dark:hover:text-slate-200",
        )}
      >
        {children}
      </button>
    </IconTooltip>
  )
}

interface ActivityToolbarSecondaryRowProps {
  pageId: ActivitySubPage
  isAllDays: boolean
  isToday: boolean
  isYesterday: boolean
  periodLabel: string
  selectedDay: Date
  showDayPicker: boolean
  onSelectDay: (day: Date) => void
  onCloseDayPicker: () => void
  onGoToToday: () => void
  onGoToYesterday: () => void
  onSelectAllDays: () => void
  onOpenDayPicker: () => void
  searchQuery: string
  onClearSearch: () => void
  hasActiveFilters: boolean
  onResetFilters: () => void
  memberLabel?: string | null
  pageFilters?: ReactNode
}

export function ActivityToolbarSecondaryRow({
  pageId,
  isAllDays,
  isToday,
  isYesterday,
  periodLabel,
  selectedDay,
  showDayPicker,
  onSelectDay,
  onCloseDayPicker,
  onGoToToday,
  onGoToYesterday,
  onSelectAllDays,
  onOpenDayPicker,
  searchQuery,
  onClearSearch,
  hasActiveFilters,
  onResetFilters,
  memberLabel,
  pageFilters,
}: ActivityToolbarSecondaryRowProps) {
  const hasSearch = searchQuery.trim().length > 0
  const isCustomDay = !isAllDays && !isToday && !isYesterday
  const formattedDay = selectedDay.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: selectedDay.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  })

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-slate-100 dark:border-slate-800 pt-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          className="flex shrink-0 items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 p-0.5"
          role="group"
          aria-label="Date range"
        >
          <ToolbarChip active={isAllDays} onClick={onSelectAllDays} title="Show all days">
            All days
          </ToolbarChip>
          <ToolbarChip active={isToday} onClick={onGoToToday} title="Jump to today">
            Today
          </ToolbarChip>
          <ToolbarChip active={isYesterday} onClick={onGoToYesterday} title="Jump to yesterday">
            Yesterday
          </ToolbarChip>
          <ScreenshotDayPickerPopover
            open={showDayPicker}
            selectedDay={selectedDay}
            onSelectDay={(day) => onSelectDay(startOfDay(day))}
            onClose={onCloseDayPicker}
          >
            <ToolbarChip
              active={isCustomDay || showDayPicker}
              onClick={onOpenDayPicker}
              title={isAllDays ? "Pick a specific day" : formattedDay}
              ariaExpanded={showDayPicker}
              ariaHasPopup="dialog"
            >
              <Calendar className="mr-1 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
              Pick date
            </ToolbarChip>
          </ScreenshotDayPickerPopover>
        </div>

        {pageFilters}

        {hasSearch ? (
          <button
            type="button"
            onClick={onClearSearch}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60"
          >
            <X className="h-3.5 w-3.5" />
            Clear search
          </button>
        ) : null}

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset filters
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {memberLabel ? (
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-600 dark:text-slate-300">{memberLabel}</span>
        ) : null}
        <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-100 dark:ring-emerald-900/60">
          {periodLabel}
        </span>
        {!isAllDays ? (
          <span className="hidden text-slate-400 dark:text-slate-500 sm:inline">{formattedDay}</span>
        ) : null}
      </div>
    </div>
  )
}

export function isYesterdayDay(day: Date): boolean {
  const today = startOfDay(new Date())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  return startOfDay(day).getTime() === yesterday.getTime()
}
