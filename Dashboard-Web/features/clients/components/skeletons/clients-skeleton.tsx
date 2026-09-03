"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { PEOPLE_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { ALL_CLIENT_COLS } from "@/features/projects/constants"
import { TableSkeletonShell } from "@/shared/tables/ui/table-skeleton-shell"
import { peopleTableCellClass, peopleTableRowStyle } from "@/shared/tables/ui"

interface ClientsSkeletonProps {
  isDark?: boolean
  rowCount?: number
  fillHeight?: boolean
  maxRowsPerPage?: number
  showActionsColumn?: boolean
}

function SkeletonFooter({ isDark }: { isDark: boolean }) {
  const tone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  return (
    <>
      <Skeleton className={cn("h-4 w-40 rounded", tone)} />
      <div className="flex items-center gap-1">
        <Skeleton className={cn("h-7 w-7 rounded", tone)} />
        <Skeleton className={cn("h-7 w-7 rounded", tone)} />
        <Skeleton className={cn("h-7 w-7 rounded", tone)} />
      </div>
    </>
  )
}

export function ClientsSkeleton({
  isDark = false,
  rowCount = PEOPLE_TABLE_ROWS_PER_PAGE,
  fillHeight = false,
  maxRowsPerPage,
  showActionsColumn = true,
}: ClientsSkeletonProps) {
  const tone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <TableSkeletonShell
        isDark={isDark}
        rowCount={rowCount}
        fillHeight={fillHeight}
        maxRowsPerPage={maxRowsPerPage}
        footer={<SkeletonFooter isDark={isDark} />}
      >
        {(rowsToRender, rowH) => (
          <table className="h-full w-full">
            <thead>
              <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                <th className="px-4 py-3 text-left">
                  <Skeleton className={cn("h-4 w-14 rounded", tone)} />
                </th>
                {ALL_CLIENT_COLS.map((col) => (
                  <th key={col.key} className="px-4 py-3 text-left">
                    <Skeleton
                      className={cn(
                        "h-4 rounded",
                        tone,
                        col.key === "auto_invoicing" ? "w-28" : col.key === "projects" ? "w-20" : "w-16",
                      )}
                    />
                  </th>
                ))}
                {showActionsColumn ? <th className="w-10 px-2 py-3" aria-hidden /> : null}
              </tr>
            </thead>
            <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/30" : "divide-slate-50")}>
              {Array.from({ length: rowsToRender }).map((_, i) => (
                <tr key={i} style={peopleTableRowStyle(rowH)}>
                  <td className={peopleTableCellClass("px-4", rowH)}>
                    <div className="flex items-center gap-3">
                      <Skeleton className={cn("h-9 w-9 shrink-0 rounded-xl", tone)} />
                      <Skeleton className={cn("h-4 w-36 rounded", tone)} />
                    </div>
                  </td>
                  <td className={peopleTableCellClass("px-4", rowH)}>
                    <Skeleton className={cn("h-4 w-24 rounded", tone)} />
                  </td>
                  <td className={peopleTableCellClass("px-4", rowH)}>
                    <Skeleton className={cn("h-6 w-24 rounded-full", tone)} />
                  </td>
                  <td className={peopleTableCellClass("px-4", rowH)}>
                    <Skeleton className={cn("h-4 w-32 rounded", tone)} />
                  </td>
                  {showActionsColumn ? (
                    <td className={peopleTableCellClass("px-2", rowH)}>
                      <Skeleton className={cn("h-6 w-6 rounded", tone)} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableSkeletonShell>
    </div>
  )
}
