"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"

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
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onPageChange(Math.max(1, currentPage - 1))
          }}
          disabled={currentPage === 1}
          className={cn(
            "rounded p-1 transition-colors disabled:pointer-events-none disabled:opacity-50",
            isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-500 hover:bg-slate-100",
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
          <button
            key={page}
            type="button"
            onClick={(e) => {
              e.preventDefault()
              onPageChange(page)
            }}
            className={cn(
              "flex h-7 min-w-[28px] items-center justify-center rounded px-1 text-sm transition-colors",
              currentPage === page
                ? isDark
                  ? "bg-[#4be277] text-[#0c1324]"
                  : "bg-blue-500 text-white"
                : isDark
                  ? "text-[#bccbb9] hover:bg-[#2e3447]"
                  : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onPageChange(Math.min(totalPages, currentPage + 1))
          }}
          disabled={currentPage === totalPages}
          className={cn(
            "rounded p-1 transition-colors disabled:pointer-events-none disabled:opacity-50",
            isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-500 hover:bg-slate-100",
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
