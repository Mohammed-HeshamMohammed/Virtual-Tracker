"use client"

import { Skeleton } from "@/shared/ui/skeleton"

export function CommandCenterSkeleton() {
  return (
    <div className="w-full space-y-8 pb-8" aria-busy="true" aria-label="Loading Command Center">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-10 w-56 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-3xl" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-3xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-3xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    </div>
  )
}
