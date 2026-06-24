"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { TEAMS_TABLE_ROWS_PER_PAGE, TEAMS_TABLE_MIN_ROWS, TEAMS_TABLE_MAX_ROWS } from "@/features/members/config/ui-config"
import { TableSkeletonShell } from "@/shared/tables/ui/table-skeleton-shell"
import { peopleTableCellClass, peopleTableRowStyle } from "@/shared/tables/ui"

interface TeamsSkeletonProps {
  isDark?: boolean
  rowCount?: number
  fillHeight?: boolean
  maxRowsPerPage?: number
  minRowsPerPage?: number
}

function SkeletonFooter({ isDark }: { isDark: boolean }) {
  return (
    <>
      <Skeleton className={cn("h-4 w-28 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
      <div className="flex items-center gap-2">
        <Skeleton className={cn("h-8 w-8 rounded-lg", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
        <Skeleton className={cn("h-8 w-8 rounded-lg", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
      </div>
    </>
  )
}

export function TeamsSkeleton({
  isDark = false,
  rowCount = TEAMS_TABLE_ROWS_PER_PAGE,
  fillHeight = false,
  maxRowsPerPage = TEAMS_TABLE_MAX_ROWS,
  minRowsPerPage = TEAMS_TABLE_MIN_ROWS,
}: TeamsSkeletonProps) {
  return (
    <TableSkeletonShell
      isDark={isDark}
      rowCount={rowCount}
      fillHeight={fillHeight}
      maxRowsPerPage={maxRowsPerPage}
      minRowsPerPage={minRowsPerPage}
      footer={<SkeletonFooter isDark={isDark} />}
    >
      {(rowsToRender, rowH) => (
        <table className="h-full w-full min-w-max">
          <thead className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
            <tr>
              <th className="px-4 py-3 text-left">
                <Skeleton className={cn("h-3 w-16 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
              </th>
              <th className="px-4 py-3 text-left">
                <Skeleton className={cn("h-3 w-20 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
              </th>
              <th className="px-4 py-3 text-left">
                <Skeleton className={cn("h-3 w-16 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
              </th>
              <th className="w-10 px-2" aria-hidden />
            </tr>
          </thead>
          <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/40" : "divide-slate-50")}>
            {Array.from({ length: rowsToRender }).map((_, i) => (
              <tr key={i} style={peopleTableRowStyle(rowH)}>
                <td className={peopleTableCellClass("px-4", rowH)}>
                  <div className="flex items-center gap-3">
                    <Skeleton className={cn("h-8 w-8 rounded-lg", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                    <div className="space-y-1.5">
                      <Skeleton className={cn("h-4 w-32 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                      <Skeleton className={cn("h-3 w-20 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                    </div>
                  </div>
                </td>
                <td className={peopleTableCellClass("px-4", rowH)}>
                  <div className="flex items-center gap-2">
                    <Skeleton className={cn("h-6 w-6 rounded-full", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                    <Skeleton className={cn("h-6 w-6 rounded-full", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                    <Skeleton className={cn("h-4 w-8 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                  </div>
                </td>
                <td className={peopleTableCellClass("px-4", rowH)}>
                  <Skeleton className={cn("h-5 w-24 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                </td>
                <td className={peopleTableCellClass("px-2", rowH)}>
                  <Skeleton className={cn("h-6 w-6 rounded", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableSkeletonShell>
  )
}
