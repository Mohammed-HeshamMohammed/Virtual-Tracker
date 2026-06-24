"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { MEMBERS_TABLE_ROWS_PER_PAGE, PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT } from "@/features/members/config/ui-config"
import { useResponsiveRowCap } from "@/shared/tables/hooks/use-responsive-row-cap"
import { MembersSkeleton } from "./members-skeleton"

function skeletonTone(isDark: boolean) {
  return isDark ? "bg-[#2e3447]" : "bg-slate-200"
}

/** Chunk-route fallback that mirrors MembersPage chrome so the table skeleton does not fill the viewport. */
export function MembersPageSkeleton({ isDark = false }: { isDark?: boolean }) {
  const tone = skeletonTone(isDark)
  const tableRowCap = useResponsiveRowCap(PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Skeleton className={cn("h-9 w-28 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-24 rounded-lg", tone)} />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className={cn("h-9 w-28 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-32 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-20 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-32 rounded-lg", tone)} />
          </div>
        </div>

        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <Skeleton className={cn("h-10 max-w-md flex-1 rounded-lg", tone)} />
          <div className="flex items-center gap-2">
            <Skeleton className={cn("h-9 w-9 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-9 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-9 rounded-lg", tone)} />
            <Skeleton className={cn("h-9 w-24 rounded-lg", tone)} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <MembersSkeleton
            isDark={isDark}
            rowCount={MEMBERS_TABLE_ROWS_PER_PAGE}
            maxRowsPerPage={tableRowCap}
            fillHeight
          />
        </div>
      </div>
    </div>
  )
}
