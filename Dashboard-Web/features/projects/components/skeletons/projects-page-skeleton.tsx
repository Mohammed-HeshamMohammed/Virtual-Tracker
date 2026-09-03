"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { TEAMS_TABLE_ROWS_PER_PAGE } from "@/features/members/config/ui-config"
import { ProjectsSkeleton } from "@/features/projects/components/skeletons/projects-skeleton"

function ToolbarSkeleton({ isDark }: { isDark: boolean }) {
  const tone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
      <div className="flex flex-1 items-center gap-3">
        <Skeleton className={cn("h-9 w-28 rounded-lg", tone)} />
        <Skeleton className={cn("h-9 w-32 rounded-lg", tone)} />
        <Skeleton className={cn("h-9 max-w-md flex-1 rounded-lg", tone)} />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className={cn("h-9 w-28 rounded-lg", tone)} />
        <Skeleton className={cn("h-9 w-32 rounded-lg", tone)} />
        <Skeleton className={cn("h-9 w-28 rounded-lg", tone)} />
      </div>
    </div>
  )
}

export function ProjectsPageSkeleton({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <ToolbarSkeleton isDark={isDark} />
        <ProjectsSkeleton isDark={isDark} rowCount={TEAMS_TABLE_ROWS_PER_PAGE} fillHeight />
      </div>
    </div>
  )
}
