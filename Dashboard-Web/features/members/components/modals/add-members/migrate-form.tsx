"use client"

import { Search, Loader2 } from "lucide-react"
import { SimpleSelect } from "@/shared/ui/simple-select"
import type { MemberRole, MigratableAuthUser } from "@/features/members/models/member"

interface MigrateFormProps {
  users: MigratableAuthUser[]
  selectedUids: Set<string>
  onToggle: (uid: string) => void
  filterText: string
  onFilterChange: (val: string) => void
  role: MemberRole
  roleOptions: MemberRole[]
  onRoleChange: (role: MemberRole) => void
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
}

const inputCls = "w-full px-2.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-emerald-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-emerald-500 transition-colors"

export function MigrateForm({
  users,
  selectedUids,
  onToggle,
  filterText,
  onFilterChange,
  role,
  roleOptions,
  onRoleChange,
  isLoading,
  hasMore,
  onLoadMore,
}: MigrateFormProps) {
  const needle = filterText.trim().toLowerCase()
  const filtered = needle
    ? users.filter((u) => u.email.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle))
    : users

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        These people already sign in through the mobile app&apos;s Firebase Authentication. Select who should also
        get access to Virtual Tracker.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter by email or name"
          className={`${inputCls} pl-8`}
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
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
          filtered.map((u) => (
            <label
              key={u.uid}
              className="flex cursor-pointer items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 px-3 py-2 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <input
                type="checkbox"
                checked={selectedUids.has(u.uid)}
                onChange={() => onToggle(u.uid)}
                className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{u.displayName || u.email || u.uid}</div>
                {u.displayName && u.email ? <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{u.email}</div> : null}
              </div>
            </label>
          ))
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

      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          ROLE*
        </label>
        <SimpleSelect
          value={role}
          onChange={(v) => onRoleChange(v as MemberRole)}
          options={roleOptions}
          portalToBody
          menuMaxVisibleItems={4}
        />
      </div>
    </div>
  )
}
