"use client"

import { OverviewSkeleton } from "@/features/projects"
import { ProjectsPageSkeleton, ProjectsSkeleton } from "@/features/projects"
import { TasksPageSkeleton } from "@/features/tasks/components/skeletons/tasks-skeleton"
import { ClientsPageSkeleton } from "@/features/clients/components/skeletons/clients-page-skeleton"
import { MemberTreePageSkeleton, MembersPageSkeleton } from "@/features/members"
import { TeamsPageSkeleton, TeamsSkeleton } from "@/features/teams"
import { Skeleton } from "@/shared/ui/skeleton"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"

const TABLE_ROWS = 5

function GenericTableSkeleton({ isDark }: { isDark: boolean }) {
  return <ProjectsSkeleton isDark={isDark} rowCount={TABLE_ROWS} fillHeight />
}

function ActivityScreensSkeleton({ isDark }: { isDark: boolean }) {
  const bone = isDark ? "bg-[#2e3447]" : "bg-slate-200"
  return (
    <div className="flex h-full min-h-[50vh] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className={cn("h-10 w-64 rounded-lg", bone)} />
        <Skeleton className={cn("h-10 w-40 rounded-lg", bone)} />
        <Skeleton className={cn("h-10 w-20 rounded-lg", bone)} />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className={cn("aspect-video w-full rounded-xl", bone)} />
        ))}
      </div>
    </div>
  )
}

/**
 * Shown while a route chunk downloads — matches each page’s existing skeleton UI.
 */
export function ChunkRouteFallback({ pageId }: { pageId: string }) {
  const { isDark } = useTheme()

  if (pageId === "command-center" || pageId === "dashboard" || pageId === "pm-overview") {
    return <OverviewSkeleton isDark={isDark} />
  }
  if (pageId === "general" || pageId === "favorites") {
    return <OverviewSkeleton isDark={isDark} />
  }

  if (pageId === "people-members") {
    return <MembersPageSkeleton isDark={isDark} />
  }
  if (pageId === "people-members-tree") {
    return <MemberTreePageSkeleton isDark={isDark} />
  }
  if (pageId === "people-teams") {
    return <TeamsPageSkeleton isDark={isDark} />
  }

  if (pageId === "pm-projects") {
    return <ProjectsPageSkeleton isDark={isDark} />
  }
  if (pageId === "pm-tasks") {
    return <TasksPageSkeleton isDark={isDark} fillHeight />
  }
  if (pageId === "pm-clients") {
    return <ClientsPageSkeleton isDark={isDark} />
  }

  if (pageId.startsWith("activity-")) {
    return <ActivityScreensSkeleton isDark={isDark} />
  }

  if (pageId.startsWith("reports-") || pageId.startsWith("financials-") || pageId.startsWith("settings-")) {
    return <GenericTableSkeleton isDark={isDark} />
  }

  if (pageId.startsWith("timesheets-")) {
    return <GenericTableSkeleton isDark={isDark} />
  }

  if (pageId === "profile") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-8">
        <Skeleton className={cn("h-24 w-24 rounded-full", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
        <Skeleton className={cn("h-10 w-full rounded-lg", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
        <Skeleton className={cn("h-10 w-full rounded-lg", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
        <Skeleton className={cn("h-32 w-full rounded-lg", isDark ? "bg-[#2e3447]" : "bg-slate-200")} />
      </div>
    )
  }

  return <GenericTableSkeleton isDark={isDark} />
}
