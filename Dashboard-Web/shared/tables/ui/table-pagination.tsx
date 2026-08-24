"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"

const ELLIPSIS = "…"

/** Page numbers to render, collapsing a long run into "1 … 27 28 29 … 68"
 * instead of one button per page. Below the threshold every page fits on
 * one line anyway, so there's nothing to collapse - a table with a fixed,
 * small page size (8-per-page screenshots grids, "All days" selected,
 * hundreds of rows) can otherwise reach 60+ pages and render 60+ buttons
 * with nothing to stop the row from spilling past the viewport. */
function paginationItems(currentPage: number, totalPages: number): (number | typeof ELLIPSIS)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items: (number | typeof ELLIPSIS)[] = [1]
  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)
  if (start > 2) items.push(ELLIPSIS)
  for (let page = start; page <= end; page++) items.push(page)
  if (end < totalPages - 1) items.push(ELLIPSIS)
  items.push(totalPages)
  return items
}

export type TablePaginationProps = {
  currentPage: number
  totalPages: number
  totalItems: number
  rowsPerPage: number
  onPageChange: (page: number) => void
  isDark?: boolean
  borderClassName?: string
}

export function TablePagination({
  currentPage,
  totalPages,
  totalItems,
  rowsPerPage,
  onPageChange,
  isDark = false,
  borderClassName,
}: TablePaginationProps) {
  if (totalItems <= 0) return null

  const border = borderClassName ?? (isDark ? "border-[#3d4a3d]/40" : "border-slate-100")
  const rangeStart = (currentPage - 1) * rowsPerPage + 1
  const rangeEnd = Math.min(currentPage * rowsPerPage, totalItems)

  return (
    <div
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-between border-t px-5 py-3",
        border,
        isDark ? "bg-[#151b2d]" : "bg-white",
      )}
    >
      <div className={cn("text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
        Showing {rangeStart}–{rangeEnd} of {totalItems}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onPageChange(Math.max(1, currentPage - 1))
          }}
          disabled={currentPage === 1}
          className={cn(
            "shrink-0 rounded p-1 transition-colors disabled:pointer-events-none disabled:opacity-50",
            isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-500 hover:bg-slate-100",
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {/* overflow-x-auto is a safety net, not the fix - paginationItems
            collapsing to ~7 buttons is what actually keeps this on one line;
            this just stops a still-unexpectedly-long row from pushing the
            page's own layout sideways instead of scrolling in place. */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {paginationItems(currentPage, totalPages).map((item, index) =>
            item === ELLIPSIS ? (
              <span
                key={`ellipsis-${index}`}
                className={cn("px-1 text-sm", isDark ? "text-[#bccbb9]/60" : "text-slate-400")}
              >
                {ELLIPSIS}
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  onPageChange(item)
                }}
                className={cn(
                  "flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded px-1 text-sm transition-colors",
                  currentPage === item
                    ? isDark
                      ? "bg-[#4be277] text-[#0c1324]"
                      : "bg-blue-500 text-white"
                    : isDark
                      ? "text-[#bccbb9] hover:bg-[#2e3447]"
                      : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {item}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onPageChange(Math.min(totalPages, currentPage + 1))
          }}
          disabled={currentPage === totalPages}
          className={cn(
            "shrink-0 rounded p-1 transition-colors disabled:pointer-events-none disabled:opacity-50",
            isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-500 hover:bg-slate-100",
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
