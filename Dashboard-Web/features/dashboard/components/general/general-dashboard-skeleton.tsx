"use client"

import { Skeleton } from "@/shared/ui/skeleton"

export function GeneralDashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-3xl" />
        ))}
      </div>
    </div>
  )
}
