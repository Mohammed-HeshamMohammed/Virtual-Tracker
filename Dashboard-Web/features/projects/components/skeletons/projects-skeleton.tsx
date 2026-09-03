"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import {
  ALL_PROJECT_COLS,
  getProjectsTableMinWidth,
  PROJECT_NAME_COL_MIN_WIDTH,
  PROJECT_COL_MIN_WIDTH,
} from "@/features/projects/constants"
import { TABLE_MIN_VISIBLE_ROWS } from "@/shared/tables/utils/table-layout"
import { TableSkeletonShell } from "@/shared/tables/ui/table-skeleton-shell"
import { peopleTableCellClass, peopleTableRowStyle } from "@/shared/tables/ui"
import {
  TEAMS_TABLE_MAX_ROWS,
  TEAMS_TABLE_MIN_ROWS,
  TEAMS_TABLE_ROWS_PER_PAGE,
} from "@/features/members/config/ui-config"

interface ProjectsSkeletonProps {
  isDark?: boolean
  rowCount?: number
  fillHeight?: boolean
  maxRowsPerPage?: number
  minRowsPerPage?: number
  showSelectColumn?: boolean
  showActionsColumn?: boolean
}

function SkeletonFooter({ isDark }: { isDark: boolean }) {
  const tone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  return (
    <>
      <Skeleton className={cn("h-4 w-40 rounded", tone)} />
      <div className="flex items-center gap-2">
        <Skeleton className={cn("h-8 w-8 rounded-lg", tone)} />
        <Skeleton className={cn("h-8 w-8 rounded-lg", tone)} />
        <Skeleton className={cn("h-8 w-8 rounded-lg", tone)} />
      </div>
    </>
  )
}

export function ProjectsSkeleton({
  isDark = false,
  rowCount = TEAMS_TABLE_ROWS_PER_PAGE,
  fillHeight = false,
  maxRowsPerPage = TEAMS_TABLE_MAX_ROWS,
  minRowsPerPage = TEAMS_TABLE_MIN_ROWS,
  showSelectColumn = true,
  showActionsColumn = true,
}: ProjectsSkeletonProps) {
  const tone = isDark ? "bg-[#2e3447]" : "bg-slate-200"
  const tableMinWidth = getProjectsTableMinWidth(ALL_PROJECT_COLS.map((col) => col.key), {
    showSelectColumn,
    showActionsColumn,
  })

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <TableSkeletonShell
        isDark={isDark}
        rowCount={rowCount}
        fillHeight={fillHeight}
        maxRowsPerPage={maxRowsPerPage}
        minRowsPerPage={TABLE_MIN_VISIBLE_ROWS}
        footer={<SkeletonFooter isDark={isDark} />}
      >
        {(rowsToRender, rowH) => (
          <table className="h-full w-full min-w-max" style={{ minWidth: tableMinWidth }}>
            <thead>
              <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
                {showSelectColumn ? (
                  <th className="w-10 shrink-0 px-5 py-3">
                    <Skeleton className={cn("h-4 w-4 rounded", tone)} />
                  </th>
                ) : null}
                <th
                  className="shrink-0 px-4 py-3 text-left"
                  style={{ minWidth: PROJECT_NAME_COL_MIN_WIDTH, width: PROJECT_NAME_COL_MIN_WIDTH }}
                >
                  <Skeleton className={cn("h-4 w-16 rounded", tone)} />
                </th>
                {ALL_PROJECT_COLS.map((col) => (
                  <th
                    key={col.key}
                    className="shrink-0 px-4 py-3 text-left"
                    style={{ minWidth: PROJECT_COL_MIN_WIDTH[col.key] ?? 100 }}
                  >
                    <Skeleton className={cn("h-4 w-20 rounded", tone)} />
                  </th>
                ))}
                {showActionsColumn ? <th className="w-10 shrink-0 px-2 py-3" aria-hidden /> : null}
              </tr>
            </thead>
            <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/30" : "divide-slate-50")}>
              {Array.from({ length: rowsToRender }).map((_, i) => (
                <tr key={i} style={peopleTableRowStyle(rowH)}>
                  {showSelectColumn ? (
                    <td className={peopleTableCellClass("px-5", rowH)}>
                      <Skeleton className={cn("h-4 w-4 rounded", tone)} />
                    </td>
                  ) : null}
                  <td
                    className={peopleTableCellClass("px-4", rowH)}
                    style={{ minWidth: PROJECT_NAME_COL_MIN_WIDTH, width: PROJECT_NAME_COL_MIN_WIDTH }}
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className={cn("h-2 w-2 shrink-0 rounded-full", tone)} />
                      <Skeleton className={cn("h-4 w-36 shrink-0 rounded", tone)} />
                    </div>
                  </td>
                  {ALL_PROJECT_COLS.map((col) => (
                    <td
                      key={col.key}
                      className={peopleTableCellClass("px-4", rowH)}
                      style={{ minWidth: PROJECT_COL_MIN_WIDTH[col.key] ?? 100 }}
                    >
                      <Skeleton
                        className={cn(
                          "h-4 rounded",
                          tone,
                          col.key === "teams" ? "w-20" : col.key === "budget" ? "w-24" : "w-12",
                        )}
                      />
                    </td>
                  ))}
                  {showActionsColumn ? (
                    <td className={peopleTableCellClass("px-2", rowH)}>
                      <Skeleton className={cn("ml-auto h-5 w-5 rounded", tone)} />
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
