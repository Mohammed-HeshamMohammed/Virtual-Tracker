"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function ReportSortableTh({
  colKey,
  label,
  sortable,
  activeKey,
  sortDir,
  onSort,
  className,
}: {
  colKey: string
  label: string
  sortable: boolean
  activeKey: string
  sortDir: "asc" | "desc"
  onSort: (k: string) => void
  className?: string
}) {
  const active = activeKey === colKey
  return (
    <th className={cn("px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-200", className)} scope="col">
      {sortable ? (
        <button
          type="button"
          className="group flex w-full min-w-0 items-center gap-1 rounded-md text-left hover:text-slate-900 dark:hover:text-white"
          onClick={() => onSort(colKey)}
        >
          <span className="truncate">{label}</span>
          {active ? (
            sortDir === "asc" ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
            )
          ) : (
            <span className="inline-flex h-3.5 w-3.5 shrink-0 flex-col text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100">
              <ChevronUp className="-mb-1 h-2 w-3.5" />
              <ChevronDown className="h-2 w-3.5" />
            </span>
          )}
        </button>
      ) : (
        label
      )}
    </th>
  )
}

