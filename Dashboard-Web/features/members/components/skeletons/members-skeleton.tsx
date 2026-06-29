"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { DEFAULT_ENABLED_MEMBER_COLS } from "@/features/members/config/members-config"
import { MEMBERS_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { MEMBER_NAME_COL_MIN_WIDTH } from "@/features/members/hooks/use-auto-hidden-table-columns"
import { TableSkeletonShell } from "@/shared/tables/ui/table-skeleton-shell"
import { peopleTableCellClass, peopleTableRowStyle } from "@/shared/tables/ui"

const INVITE_COL_COUNT = 6

interface MembersSkeletonProps {
  isDark?: boolean
  rowCount?: number
  fillHeight?: boolean
  maxRowsPerPage?: number
  showSelectColumn?: boolean
  showActionsColumn?: boolean
  columnKeys?: readonly string[]
}

function skeletonTone(isDark: boolean) {
  return isDark ? "bg-[#2e3447]" : "bg-slate-200"
}

function SkeletonFooter({ isDark }: { isDark: boolean }) {
  const tone = skeletonTone(isDark)
  return (
    <>
      <Skeleton className={cn("h-4 w-32 rounded", tone)} />
      <div className="flex items-center gap-2">
        <Skeleton className={cn("h-8 w-8 rounded-lg", tone)} />
        <Skeleton className={cn("h-8 w-8 rounded-lg", tone)} />
      </div>
    </>
  )
}

function SkeletonBar({ isDark, className }: { isDark: boolean; className?: string }) {
  return <Skeleton className={cn("h-4 rounded", skeletonTone(isDark), className)} />
}

function MemberCellSkeleton({ isDark }: { isDark: boolean }) {
  const tone = skeletonTone(isDark)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Skeleton className={cn("h-8 w-8 shrink-0 rounded-full", tone)} />
      <Skeleton className={cn("h-4 w-32 max-w-full rounded", tone)} />
    </div>
  )
}

export function MembersSkeleton({
  isDark = false,
  rowCount = MEMBERS_TABLE_ROWS_PER_PAGE,
  fillHeight = false,
  maxRowsPerPage,
  showSelectColumn = true,
  showActionsColumn = true,
  columnKeys,
}: MembersSkeletonProps) {
  const visibleColumns = columnKeys ?? [...DEFAULT_ENABLED_MEMBER_COLS]
  const tone = skeletonTone(isDark)
  const selectColClass = cn(
    "sticky left-0 z-10 w-11 min-w-[44px] shrink-0 px-4",
    isDark ? "bg-[#151b2d]" : "bg-white",
  )

  return (
    <TableSkeletonShell
      isDark={isDark}
      rowCount={rowCount}
      fillHeight={fillHeight}
      maxRowsPerPage={maxRowsPerPage}
      footer={<SkeletonFooter isDark={isDark} />}
    >
      {(rowsToRender, rowH) => (
        <table className="h-full w-full min-w-max">
          <thead>
            <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
              {showSelectColumn && (
                <th className={cn(selectColClass, "py-3", isDark ? "bg-[#151b2d]" : "bg-white")}>
                  <SkeletonBar isDark={isDark} className="h-4 w-4" />
                </th>
              )}
              <th
                className="shrink-0 px-4 py-3 text-left"
                style={{ minWidth: MEMBER_NAME_COL_MIN_WIDTH, width: MEMBER_NAME_COL_MIN_WIDTH }}
              >
                <SkeletonBar isDark={isDark} className="h-3 w-16" />
              </th>
              {visibleColumns.map((key) => (
                <th key={key} className="px-4 py-3 text-left">
                  <SkeletonBar isDark={isDark} className="h-3 w-20" />
                </th>
              ))}
              {showActionsColumn && <th className="w-12 px-2" aria-hidden />}
            </tr>
          </thead>
          <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/40" : "divide-slate-50")}>
            {Array.from({ length: rowsToRender }).map((_, i) => (
              <tr key={i} style={peopleTableRowStyle(rowH)}>
                {showSelectColumn && (
                  <td className={peopleTableCellClass(cn(selectColClass), rowH)}>
                    <Skeleton className={cn("h-4 w-4 rounded", tone)} />
                  </td>
                )}
                <td className={peopleTableCellClass("shrink-0 px-4", rowH)} style={{ minWidth: MEMBER_NAME_COL_MIN_WIDTH, width: MEMBER_NAME_COL_MIN_WIDTH }}>
                  <MemberCellSkeleton isDark={isDark} />
                </td>
                {visibleColumns.map((key) => (
                  <td key={key} className={peopleTableCellClass("px-4", rowH)}>
                    <SkeletonBar isDark={isDark} className="w-20" />
                  </td>
                ))}
                {showActionsColumn && (
                  <td className={peopleTableCellClass("px-2", rowH)}>
                    <Skeleton className={cn("h-6 w-6 rounded", tone)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableSkeletonShell>
  )
}

export function InvitesSkeleton({
  isDark = false,
  rowCount = MEMBERS_TABLE_ROWS_PER_PAGE,
  fillHeight = false,
  maxRowsPerPage,
}: MembersSkeletonProps) {
  const tone = skeletonTone(isDark)

  return (
    <TableSkeletonShell
      isDark={isDark}
      rowCount={rowCount}
      fillHeight={fillHeight}
      maxRowsPerPage={maxRowsPerPage}
      footer={<SkeletonFooter isDark={isDark} />}
    >
      {(rowsToRender, rowH) => (
        <table className="h-full w-full min-w-max">
          <thead>
            <tr className={cn("border-b", isDark ? "border-[#3d4a3d]/40" : "border-slate-100")}>
              <th className="w-10 px-5 py-3">
                <SkeletonBar isDark={isDark} className="h-4 w-4" />
              </th>
              {Array.from({ length: INVITE_COL_COUNT }).map((_, i) => (
                <th key={i} className="px-4 py-3 text-left">
                  <SkeletonBar isDark={isDark} className="h-3 w-20" />
                </th>
              ))}
              <th className="w-12 px-2" aria-hidden />
            </tr>
          </thead>
          <tbody className={cn("divide-y", isDark ? "divide-[#3d4a3d]/40" : "divide-slate-50")}>
            {Array.from({ length: rowsToRender }).map((_, i) => (
              <tr key={i} style={peopleTableRowStyle(rowH)}>
                <td className={peopleTableCellClass("w-10 px-5", rowH)}>
                  <Skeleton className={cn("h-4 w-4 rounded", tone)} />
                </td>
                <td className={peopleTableCellClass("px-4", rowH)}>
                  <MemberCellSkeleton isDark={isDark} />
                </td>
                {Array.from({ length: INVITE_COL_COUNT - 1 }).map((_, j) => (
                  <td key={j} className={peopleTableCellClass("px-4", rowH)}>
                    <SkeletonBar isDark={isDark} className="w-20" />
                  </td>
                ))}
                <td className={peopleTableCellClass("px-2", rowH)}>
                  <Skeleton className={cn("h-6 w-6 rounded", tone)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableSkeletonShell>
  )
}
