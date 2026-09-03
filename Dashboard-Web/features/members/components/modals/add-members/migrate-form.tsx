"use client"

import { Search, Loader2 } from "lucide-react"
import { Avatar } from "@/shared/ui/avatar"
import { Checkbox } from "@/shared/ui/checkbox"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { initialsFromName, memberAvatarColor } from "@/features/members/utils/build-tree"
import type { MemberRole, MigratableAuthUser } from "@/features/members/models/member"

interface MigrateFormProps {
  users: MigratableAuthUser[]
  selectedUids: Set<string>
  onToggle: (uid: string) => void
  onToggleMany: (uids: string[], selected: boolean) => void
  filterText: string
  onFilterChange: (val: string) => void
  resolveRole: (user: MigratableAuthUser) => MemberRole
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
}

const inputCls = "w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500 transition-colors"

export function MigrateForm({
  users,
  selectedUids,
  onToggle,
  onToggleMany,
  filterText,
  onFilterChange,
  resolveRole,
  isLoading,
  hasMore,
  onLoadMore,
}: MigrateFormProps) {
  const { isDark } = useTheme()
  const needle = filterText.trim().toLowerCase()
  const filtered = needle
    ? users.filter((u) => u.email.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle))
    : users

  const selectedInView = filtered.reduce((count, u) => (selectedUids.has(u.uid) ? count + 1 : count), 0)
  const allInViewSelected = filtered.length > 0 && selectedInView === filtered.length

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        These people already sign in through the mobile app&apos;s Firebase Authentication. Select who should also
        get access to Virtual Tracker — the role shown is suggested automatically from their mobile-app profile.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          id="migrate-filter"
          name="migrate-filter"
          type="text"
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter by email or name"
          aria-label="Filter by email or name"
          className={`${inputCls} pl-8`}
        />
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2">
          <div
            role="button"
            tabIndex={0}
            aria-pressed={allInViewSelected}
            onClick={() => onToggleMany(filtered.map((u) => u.uid), !allInViewSelected)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onToggleMany(filtered.map((u) => u.uid), !allInViewSelected)
              }
            }}
            className="flex cursor-pointer items-center gap-2.5"
          >
            <Checkbox
              checked={allInViewSelected}
              isDark={isDark}
              onChange={(e) => {
                e.stopPropagation()
                onToggleMany(filtered.map((u) => u.uid), !allInViewSelected)
              }}
            />
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {allInViewSelected ? "Deselect all" : "Select all"}
              {needle ? " shown" : ""}
            </span>
          </div>
          <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
            {selectedInView} of {filtered.length} selected
          </span>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto scrollbar-hide rounded-lg border border-slate-200 dark:border-slate-700">
        {isLoading && users.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400 dark:text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            {users.length === 0 ? "No unlinked accounts found." : "No matches for this filter."}
          </div>
        ) : (
          filtered.map((u) => {
            const displayName = u.displayName || u.email || u.uid
            const role = resolveRole(u)
            const checked = selectedUids.has(u.uid)
            return (
              <div
                key={u.uid}
                role="button"
                tabIndex={0}
                aria-pressed={checked}
                onClick={() => onToggle(u.uid)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onToggle(u.uid)
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 border-b border-slate-100 dark:border-slate-800 px-3 py-3 last:border-b-0 transition-colors",
                  checked ? "bg-blue-50/60 dark:bg-emerald-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40",
                )}
              >
                <Checkbox
                  checked={checked}
                  isDark={isDark}
                  onChange={(e) => {
                    e.stopPropagation()
                    onToggle(u.uid)
                  }}
                />
                <Avatar
                  initials={initialsFromName(displayName)}
                  color={memberAvatarColor(u.uid, false)}
                  imageUrl={u.avatarUrl}
                  alt={displayName}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{displayName}</div>
                  {u.displayName && u.email ? <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{u.email}</div> : null}
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                  {role}
                </span>
              </div>
            )
          })
        )}
      </div>

      {hasMore && !needle && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoading}
          className="text-xs text-blue-500 dark:text-emerald-400 hover:text-blue-600 dark:hover:text-emerald-300 font-semibold transition-colors disabled:text-slate-400 dark:disabled:text-slate-600"
        >
          {isLoading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  )
}
