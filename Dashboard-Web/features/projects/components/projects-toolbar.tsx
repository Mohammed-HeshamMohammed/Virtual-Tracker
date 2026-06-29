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
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors",
                    tab === statusTab ? t.tabActive : t.tabInactive,
                  )}
                >
                  {statusTab === "active" ? (
                    <>
                      <FolderOpen className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">Active</span>
                    </>
                  ) : (
                    <>
                      <FolderArchive className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">Archived</span>
                    </>
                  )}
                  <span
                    className={cn(
                      "inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs tabular-nums",
                      t.tabBadge,
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
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColPicker((v) => !v)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-colors",
                isDark
                  ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <Table2 className="h-4 w-4" />
              <span className="hidden sm:inline">Columns</span>
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0" onClick={() => setShowColPicker(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
                <div className={cn("absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border py-2 shadow-xl", t.dropdown)}>
                  <div className={cn("px-3 py-1.5 text-xs font-semibold uppercase tracking-wider", t.dropdownHeader)}>
                    Show columns
                  </div>
                  {ALL_PROJECT_COLS.map((col) => (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleProjectCol(col.key)}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-sm transition-colors",
                        enabledCols.has(col.key)
                          ? isDark
                            ? "text-[#dce1fb] hover:bg-[#2e3447]"
                            : "text-slate-800 hover:bg-slate-50"
                          : isDark
                            ? "text-[#bccbb9] hover:bg-[#2e3447]"
                            : "text-slate-400 hover:bg-slate-50",
                      )}
                    >
                      {col.label}
                      {enabledCols.has(col.key) && (
                        <Check className={cn("h-3.5 w-3.5", isDark ? "text-[#4be277]" : "text-blue-500")} />
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
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  selectedInView > 0
                    ? isDark
                      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#dce1fb] hover:bg-[#2e3447]"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    : isDark
                      ? "cursor-not-allowed border-[#3d4a3d]/20 bg-[#151b2d] text-[#3d4a3d]"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300",
                )}
              >
                <span className="hidden md:inline">Batch actions</span>
                <ChevronDown className="h-4 w-4" />
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
                      className={cn("absolute left-0 top-10 z-20 w-44 rounded-xl border py-1 shadow-lg", t.dropdown)}
                    >
                      {PROJECT_BATCH_ACTIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setBatchOpen(false)}
                          className={cn(
                            "w-full px-3 py-2 text-left text-xs transition-colors",
                            action.includes("Delete") ? t.menuItemDanger : t.dropdownItem,
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
              className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors sm:px-4", t.btnPrimary)}
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
