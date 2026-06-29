"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { MEMBERS_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { TableSkeletonShell } from "@/shared/tables/ui/table-skeleton-shell"
import { peopleTableCellClass, peopleTableRowStyle } from "@/shared/tables/ui"

interface MemberBansSkeletonProps {
  isDark?: boolean
  rowCount?: number
  fillHeight?: boolean
  maxRowsPerPage?: number
}

export function MemberBansSkeleton({
  isDark = false,
  rowCount = MEMBERS_TABLE_ROWS_PER_PAGE,
  fillHeight = false,
  maxRowsPerPage,
}: MemberBansSkeletonProps) {
  const tone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  return (
    <TableSkeletonShell isDark={isDark} rowCount={rowCount} fillHeight={fillHeight} maxRowsPerPage={maxRowsPerPage}>
      {(rowsToRender, rowH) => (
        <table className="h-full w-full min-w-[640px]">
          <thead className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
            <tr>
              <th className="px-4 py-3 text-left">
                <Skeleton className={cn("h-3 w-16 rounded", tone)} />
              </th>
              <th className="px-4 py-3 text-left">
                <Skeleton className={cn("h-3 w-16 rounded", tone)} />
              </th>
              <th className="px-4 py-3 text-right">
                <Skeleton className={cn("ml-auto h-3 w-16 rounded", tone)} />
              </th>
            </tr>
          </thead>
          <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/40" : "divide-slate-50")}>
            {Array.from({ length: rowsToRender }).map((_, i) => (
              <tr key={i} style={peopleTableRowStyle(rowH)}>
                <td className={peopleTableCellClass("px-4", rowH)}>
                  <div className="flex items-center gap-3">
                    <Skeleton className={cn("h-8 w-8 rounded-full", tone)} />
                    <div className="space-y-1.5">
                      <Skeleton className={cn("h-4 w-32 rounded", tone)} />
                      <Skeleton className={cn("h-3 w-40 rounded", tone)} />
                    </div>
                  </div>
                </td>
                <td className={peopleTableCellClass("px-4", rowH)}>
                  <Skeleton className={cn("h-4 w-full max-w-xs rounded", tone)} />
                  <Skeleton className={cn("mt-2 h-3 w-48 rounded", tone)} />
                </td>
                <td className={peopleTableCellClass("px-4 text-right", rowH)}>
                  <Skeleton className={cn("ml-auto h-8 w-24 rounded-lg", tone)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableSkeletonShell>
  )
}
