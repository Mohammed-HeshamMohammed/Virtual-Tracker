"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"

interface TasksContentSkeletonProps {
  isDark?: boolean
  fillHeight?: boolean
}

export function TasksContentSkeleton({ isDark = false, fillHeight = false }: TasksContentSkeletonProps) {
  const bone = isDark ? "bg-[#2e3447]" : "bg-slate-200"
  const border = isDark ? "border-[#3d4a3d]/40" : "border-slate-200"
  const panelBg = isDark ? "bg-[#0c1324]" : "bg-white"

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border",
        fillHeight && "flex min-h-0 flex-1 flex-col",
        border,
        panelBg,
      )}
    >
      <div className={cn("shrink-0 border-b px-4 py-3", border)}>
        <Skeleton className={cn("h-4 w-32 rounded", bone)} />
      </div>
      <div className={cn("flex min-h-0 flex-col", fillHeight && "flex-1")}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn("flex shrink-0 items-center gap-4 border-b px-4 py-3 last:border-b-0", border)}>
            <Skeleton className={cn("h-4 w-4 rounded-full", bone)} />
            <Skeleton className={cn("h-4 max-w-md flex-1 rounded", bone)} />
            <Skeleton className={cn("h-6 w-6 rounded-full", bone)} />
            <Skeleton className={cn("h-4 w-16 rounded", bone)} />
            <Skeleton className={cn("h-4 w-20 rounded", bone)} />
          </div>
        ))}
        {fillHeight ? <div className="min-h-0 flex-1" aria-hidden="true" /> : null}
      </div>
    </div>
  )
}

function ToolbarSkeleton({ isDark }: { isDark: boolean }) {
  const bone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
      <Skeleton className={cn("h-9 w-56 rounded-xl", bone)} />
      <Skeleton className={cn("h-9 w-36 rounded-lg", bone)} />
      <Skeleton className={cn("h-9 w-32 rounded-lg", bone)} />
      <Skeleton className={cn("h-9 max-w-xs flex-1 rounded-lg", bone)} />
      <Skeleton className={cn("ml-auto h-9 w-24 rounded-lg", bone)} />
      <Skeleton className={cn("h-9 w-20 rounded-lg", bone)} />
    </div>
  )
}

export function TasksPageSkeleton({ isDark = false, fillHeight = false }: { isDark?: boolean; fillHeight?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2", fillHeight && "min-h-0 flex-1")}>
      <ToolbarSkeleton isDark={isDark} />
      <TasksContentSkeleton isDark={isDark} fillHeight={fillHeight} />
    </div>
  )
}

export function TasksSkeleton(props: TasksContentSkeletonProps) {
  return <TasksPageSkeleton {...props} />
}
