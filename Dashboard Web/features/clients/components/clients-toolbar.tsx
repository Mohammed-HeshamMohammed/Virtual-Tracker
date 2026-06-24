"use client"

import { Search, Plus, Table2, Check, Users } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { ALL_CLIENT_COLS } from "@/features/projects/constants"
import type { ClientStatus } from "@/features/clients/models/client"

interface ClientsToolbarProps {
  tab: ClientStatus
  setTab: (tab: ClientStatus) => void
  setSearch: (search: string) => void
  search: string
  counts: { active: number; archived: number }
  showColPicker: boolean
  setShowColPicker: (show: boolean | ((prev: boolean) => boolean)) => void
  toggleCol: (colKey: string) => void
  enabledCols: Set<string>
  isDark: boolean
  t: {
    tabActive: string
    tabInactive: string
    tabBadge: string
    searchWrap: string
    searchIcon: string
    searchInput: string
    dropdown: string
    dropdownHeader: string
    btnSecondary: string
    btnPrimary: string
  }
  openAddClientModal: (memberId?: string) => void
  canManageClients?: boolean
}

export function ClientsToolbar({
  tab,
  setTab,
  setSearch,
  search,
  counts,
  showColPicker,
  setShowColPicker,
  toggleCol,
  enabledCols,
  isDark,
  t,
  openAddClientModal,
  canManageClients = true,
}: ClientsToolbarProps) {
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
      <div className="flex flex-1 items-center gap-3">
        {(["active", "archived"] as const).map((statusTab) => (
          <button
            key={statusTab}
            type="button"
            onClick={() => {
              setTab(statusTab)
              setSearch("")
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              tab === statusTab ? t.tabActive : t.tabInactive,
            )}
          >
            <Users className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{statusTab.charAt(0).toUpperCase() + statusTab.slice(1)}</span>
            <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs", t.tabBadge)}>{counts[statusTab]}</span>
          </button>
        ))}
        <div className={cn("relative max-w-md flex-1 rounded-lg border", t.searchWrap)}>
          <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", t.searchIcon)} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className={cn("w-full bg-transparent py-2 pl-10 pr-4 text-sm focus:outline-none", t.searchInput)} aria-label="Interactive control"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
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
            Columns
          </button>
          {showColPicker && (
            <>
              <div className="fixed inset-0" onClick={() => setShowColPicker(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} />
              <div className={cn("absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border py-2 shadow-xl", t.dropdown)}>
                <div className={cn("px-3 py-1.5 text-xs font-semibold uppercase tracking-wider", t.dropdownHeader)}>
                  Show columns
                </div>
                {ALL_CLIENT_COLS.map((col) => (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => toggleCol(col.key)}
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
        {canManageClients ? (
          <button
            type="button"
            onClick={() => openAddClientModal()}
            className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors", t.btnPrimary)}
          >
            <Plus className="h-4 w-4" />
            Add client
          </button>
        ) : null}
      </div>
    </div>
  )
}
