"use client"

import { TeamsSkeleton } from "./teams-skeleton"

/** Chunk-route fallback — table-only skeleton; toolbar chrome stays on TeamsPage during data load. */
export function TeamsPageSkeleton({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <div className="flex min-h-0 flex-1 flex-col">
          <TeamsSkeleton isDark={isDark} fillHeight />
        </div>
      </div>
    </div>
  )
}
