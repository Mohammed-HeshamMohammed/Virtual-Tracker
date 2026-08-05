/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { motion, AnimatePresence } from "framer-motion"
import {
  Plus,
  ChevronDown,
  FolderOpen,
  FolderArchive,
  Table2,
  Check,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { PROJECT_BATCH_ACTIONS } from "@/features/projects/config/project-management-config"
import {
  PageSearchDismissButton,
  PageSearchInput,
  PageSearchToggleButton,
} from "@/shared/tables/ui/responsive-page-search"
import { ALL_PROJECT_COLS } from "@/features/projects/constants"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

interface ProjectsToolbarProps {
  tab: "active" | "archived"
  setTab: (tab: "active" | "archived") => void
  setSelected: (selected: Set<string>) => void
  setSearch: (search: string) => void
  search: string
  compactSearch: boolean
  searchExpanded: boolean
  setSearchExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void
  searchTheme: { searchWrap: string; searchIcon: string; searchInput: string }
  isDark: boolean
  counts: { active: number; archived: number }
  showColPicker: boolean
  setShowColPicker: (show: boolean | ((prev: boolean) => boolean)) => void
  toggleProjectCol: (colKey: string) => void
  enabledCols: Set<string>
  selectedInView: number
  batchOpen: boolean
  setBatchOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  openAddProjectModal: () => void
  showCompactSearchRow: boolean
  toolbarRef: React.RefObject<HTMLDivElement | null>
  canManageProjects?: boolean
  onRefresh: () => void
  isRefreshing?: boolean
  t: {
    tabActive: string
    tabInactive: string
    tabBadge: string
    searchWrap: string
    searchIcon: string
    searchInput: string
    dropdown: string
    dropdownHeader: string
    dropdownItem: string
    menuItemDanger: string
    btnPrimary: string
    btnSecondary: string
  }
}

export function ProjectsToolbar({
  tab,
  setTab,
  setSelected,
  setSearch,
  search,
  compactSearch,
  searchExpanded,
  setSearchExpanded,
  searchTheme,
  isDark,
  counts,
  showColPicker,
  setShowColPicker,
  toggleProjectCol,
  enabledCols,
  selectedInView,
  batchOpen,
  setBatchOpen,
  openAddProjectModal,
  showCompactSearchRow,
  toolbarRef,
  canManageProjects = true,
  onRefresh,
  isRefreshing = false,
  t,
}: ProjectsToolbarProps) {
  const hasSearchQuery = search.trim().length > 0

  return (
    <motion.div ref={toolbarRef} className="mb-3 flex shrink-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          {(["active", "archived"] as const).map((statusTab) => {
            const tabLabel = statusTab.charAt(0).toUpperCase() + statusTab.slice(1)
            return (
              <IconTooltip key={statusTab} text={tabLabel} isDark={isDark}>
                <button
                  type="button"
                  onClick={() => {
                    setTab(statusTab)
                    setSelected(new Set())
                    setSearch("")
                    setSearchExpanded(false)
                  }}
                  aria-label={tabLabel}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all shadow-sm",
                    tab === statusTab
                      ? "border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                      : "border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white",
                  )}
                >
                  {statusTab === "active" ? (
                    <>
                      <FolderOpen className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="hidden sm:inline">Active</span>
                    </>
                  ) : (
                    <>
                      <FolderArchive className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="hidden sm:inline">Archived</span>
                    </>
                  )}
                  <span
                    className={cn(
                      "inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                      tab === statusTab
                        ? "bg-emerald-200/80 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200"
                        : "bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300",
                    )}
                  >
                    {counts[statusTab]}
                  </span>
                </button>
              </IconTooltip>
            )
          })}
          {!compactSearch ? (
            <PageSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search projects..."
              theme={searchTheme}
              className="w-56 shrink-0 sm:w-64"
            />
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {compactSearch ? (
            <PageSearchToggleButton
              active={searchExpanded}
              hasQuery={hasSearchQuery}
              onClick={() => setSearchExpanded((open) => !open)}
              isDark={isDark}
            />
          ) : null}
          <IconTooltip text="Refresh" isDark={isDark}>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Refresh projects"
              className={cn(
                "flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <RefreshCw className={cn("h-4 w-4 text-slate-500 dark:text-slate-400", isRefreshing && "animate-spin")} />
            </button>
          </IconTooltip>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColPicker((v) => !v)}
              className={cn(
                "flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80",
              )}
            >
              <Table2 className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <span className="hidden sm:inline">Columns</span>
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
                <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 py-2 shadow-xl backdrop-blur-xl">
                  <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Show columns
                  </div>
                  {ALL_PROJECT_COLS.map((col) => (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleProjectCol(col.key)}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium transition-colors text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/80"
                    >
                      {col.label}
                      {enabledCols.has(col.key) && (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {canManageProjects ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setBatchOpen((v) => !v)}
                disabled={selectedInView === 0}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <span className="hidden md:inline">Batch actions</span>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              <AnimatePresence>
                {batchOpen && selectedInView > 0 ? (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setBatchOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute left-0 top-11 z-20 w-48 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 py-1.5 shadow-xl backdrop-blur-xl"
                    >
                      {PROJECT_BATCH_ACTIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setBatchOpen(false)}
                          className={cn(
                            "w-full px-3.5 py-2 text-left text-xs font-semibold transition-colors",
                            action.includes("Delete")
                              ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              : "text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/80",
                          )}
                        >
                          {action}
                        </button>
                      ))}
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}

          {canManageProjects ? (
            <button
              type="button"
              onClick={openAddProjectModal}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.02] hover:shadow-emerald-600/30 active:scale-95 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add project</span>
            </button>
          ) : null}
        </div>
      </div>

      {showCompactSearchRow ? (
        <div className="flex min-w-0 items-center gap-2">
          <PageSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search projects..."
            theme={searchTheme}
            className="min-w-0 flex-1 sm:max-w-md"
            autoFocus={searchExpanded}
          />
          <PageSearchDismissButton
            onClick={() => setSearchExpanded(false)}
            isDark={isDark}
          />
        </div>
      ) : null}
    </motion.div>
  )
}
