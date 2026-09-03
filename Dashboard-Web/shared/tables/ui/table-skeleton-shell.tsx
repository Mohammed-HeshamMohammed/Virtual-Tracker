"use client"

import { useRef, type ReactNode } from "react"
import { cn } from "@/shared/utils/utils"
import { TableScroll } from "@/shared/tables/ui/table-scroll"
import { useDynamicRowCount } from "@/shared/tables/hooks/use-paginated-table"

type PeopleTableSkeletonShellProps = {
  isDark?: boolean
  rowCount?: number
  fillHeight?: boolean
  maxRowsPerPage?: number
  minRowsPerPage?: number
  children: (rowsToRender: number, rowHeight?: number) => ReactNode
  footer?: ReactNode
}

export function TableSkeletonShell({
  isDark = false,
  rowCount = 10,
  fillHeight = false,
  maxRowsPerPage,
  minRowsPerPage,
  children,
  footer,
}: PeopleTableSkeletonShellProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const includesPagination = !!footer
  const dynamicRowCount = useDynamicRowCount(
    fillHeight ? containerRef : undefined,
    rowCount,
    includesPagination,
    maxRowsPerPage,
    minRowsPerPage,
  )
  const rowsToRender = fillHeight ? dynamicRowCount : rowCount

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border shadow-sm",
        fillHeight && "flex-1",
        isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-100 bg-white",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableScroll
          visibleRowCount={rowsToRender}
          scrollRef={scrollRef}
          className="overflow-x-auto"
        >
          {(rowHeight) => children(rowsToRender, rowHeight)}
        </TableScroll>
      </div>
      {footer ? (
        <div
          className={cn(
            "flex shrink-0 items-center justify-between border-t px-4 py-3",
            isDark ? "border-[#3d4a3d]/40" : "border-slate-100",
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
