"use client"

import { useState } from "react"
import { ChevronDown, Trash2 } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { STATUS_CONFIG, type TaskStatus } from "@/features/projects/constants"

export function TasksBatchBar({
  count,
  onClear,
  onDeleteRequest,
  onChangeStatus,
  canMarkCompleted,
  busy,
  isDark,
}: {
  count: number
  onClear: () => void
  onDeleteRequest: () => void
  onChangeStatus: (status: TaskStatus) => void
  canMarkCompleted: boolean
  busy: boolean
  isDark: boolean
}) {
  const [statusOpen, setStatusOpen] = useState(false)
  if (count === 0) return null

  const statuses = (Object.entries(STATUS_CONFIG) as [TaskStatus, (typeof STATUS_CONFIG)[TaskStatus]][])
    .filter(([status]) => status !== "in_review")
    .filter(([status]) => canMarkCompleted || status !== "done")

  return (
    <div
      className={cn(
        "mb-3 flex shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2",
        isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-200 bg-slate-50",
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn("text-sm font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-700")}>
          {count} selected
        </span>
        <button
          type="button"
          onClick={onClear}
          className={cn("text-xs font-medium underline-offset-2 hover:underline", isDark ? "text-[#bccbb9]" : "text-slate-500")}
        >
          Clear
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setStatusOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              isDark
                ? "border-[#2e3447] bg-[#1e2538] text-[#dce1fb] hover:bg-[#2e3447]"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
            )}
          >
            Change status
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {statusOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
              <div
                className={cn(
                  "absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border py-1.5 shadow-xl",
                  isDark ? "border-[#2e3447] bg-[#1e2538]" : "border-slate-200 bg-white",
                )}
              >
                {statuses.map(([s, cfg]) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStatusOpen(false)
                      onChangeStatus(s)
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition-colors",
                      cfg.color,
                      isDark ? "hover:bg-[#2e3447]" : "hover:bg-slate-100",
                    )}
                  >
                    {cfg.icon}
                    {cfg.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onDeleteRequest}
          className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:bg-[#1e2538] dark:text-rose-400 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete selected
        </button>
      </div>
    </div>
  )
}
