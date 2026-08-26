"use client"

import { Check, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function WorkSessionsFiltersPanel({
  onClose,
  className,
  projectOptions,
  memberOptions,
  projectFilter,
  memberFilter,
  onToggleProject,
  onToggleMember,
  onClearProjects,
  onClearMembers,
  onSelectAllProjects,
  onSelectAllMembers,
}: {
  onClose: () => void
  className?: string
  projectOptions: string[]
  memberOptions: string[]
  projectFilter: Set<string> | null
  memberFilter: Set<string> | null
  onToggleProject: (name: string) => void
  onToggleMember: (name: string) => void
  onClearProjects: () => void
  onClearMembers: () => void
  onSelectAllProjects: () => void
  onSelectAllMembers: () => void
}) {
  return (
    <div
      className={cn(
        "flex h-[500px] w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#151b2d] shadow-sm",
        className ?? "fixed right-16 top-1/2 -translate-y-1/2"
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-[#dce1fb]">Filters</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 dark:text-white/40 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 scrollbar-hide">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Projects</div>
            <button type="button" onClick={onSelectAllProjects} className="text-xs font-medium text-blue-500 hover:text-blue-600">
              Select all
            </button>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 dark:border-white/10 p-2 scrollbar-hide">
            {projectOptions.map((p) => {
              const on = projectFilter === null ? true : projectFilter.has(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onToggleProject(p)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-700 dark:text-[#dce1fb] hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-white/20 bg-white dark:bg-[#151b2d]"
                    )}
                  >
                    {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                  </span>
                  <span className="truncate">{p}</span>
                </button>
              )
            })}
          </div>
          <button type="button" onClick={onClearProjects} className="mt-2 text-xs text-slate-500 dark:text-white/45 hover:text-slate-700 dark:hover:text-[#dce1fb]">
            Clear projects
          </button>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Members</div>
            <button type="button" onClick={onSelectAllMembers} className="text-xs font-medium text-blue-500 hover:text-blue-600">
              Select all
            </button>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 dark:border-white/10 p-2 scrollbar-hide">
            {memberOptions.map((m) => {
              const on = memberFilter === null ? true : memberFilter.has(m)
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onToggleMember(m)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-700 dark:text-[#dce1fb] hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-white/20 bg-white dark:bg-[#151b2d]"
                    )}
                  >
                    {on ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                  </span>
                  <span className="truncate">{m}</span>
                </button>
              )
            })}
          </div>
          <button type="button" onClick={onClearMembers} className="mt-2 text-xs text-slate-500 dark:text-white/45 hover:text-slate-700 dark:hover:text-[#dce1fb]">
            Clear members
          </button>
        </div>
      </div>
      <div className="border-t border-slate-100 dark:border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white hover:bg-blue-600"
        >
          Done
        </button>
      </div>
    </div>
  )
}

