"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { TASK_PANEL_HEIGHT_CLASS } from "@/features/projects/constants/project-constants"

interface OverviewSkeletonProps {
  isDark?: boolean
}

/** Loading placeholder matching the Project Management Overview layout. */
export function OverviewSkeleton({ isDark = false }: OverviewSkeletonProps) {
  const bone = isDark ? "bg-[#2e3447]" : "bg-slate-200"
  const border = isDark ? "border-[#3d4a3d]/40" : "border-slate-100"
  const panelBg = isDark ? "bg-[#0c1324]" : "bg-white"

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-6 scrollbar-hide">
        <section className="flex min-h-full flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={cn("rounded-2xl p-5 border shadow-sm", panelBg, border)}
              >
                <div className="flex items-start justify-between mb-3">
                  <Skeleton className={cn("w-10 h-10 rounded-xl", bone)} />
                  <Skeleton className={cn("w-4 h-4 rounded", bone)} />
                </div>
                <Skeleton className={cn("h-7 w-20 rounded mb-2", bone)} />
                <Skeleton className={cn("h-4 w-24 rounded mb-1", bone)} />
                <Skeleton className={cn("h-3 w-16 rounded", bone)} />
              </div>
            ))}
          </div>

          <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm", panelBg, border)}>
            <div className={cn("flex items-center justify-between border-b px-6 py-4", border)}>
              <div className="flex items-center gap-2">
                <Skeleton className={cn("w-4 h-4 rounded", bone)} />
                <Skeleton className={cn("h-4 w-32 rounded", bone)} />
                <Skeleton className={cn("h-4 w-6 rounded-full", bone)} />
              </div>
              <Skeleton className={cn("h-3 w-20 rounded", bone)} />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-slate-50 bg-slate-50/50">
                  <tr>
                    {["Project", "Health", "Progress", "Budget", "Members"].map((label) => (
                      <th key={label} className="px-4 py-2.5 text-left first:px-6">
                        <Skeleton className={cn("h-3 w-16 rounded", bone)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Skeleton className={cn("h-2 w-2 shrink-0 rounded-full", bone)} />
                          <Skeleton className={cn("h-4 w-28 rounded", bone)} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Skeleton className={cn("h-5 w-16 rounded-full", bone)} />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <Skeleton className={cn("h-1.5 w-20 rounded-full", bone)} />
                          <Skeleton className={cn("h-3 w-6 rounded", bone)} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Skeleton className={cn("h-1.5 w-16 rounded-full", bone)} />
                      </td>
                      <td className="px-4 py-3.5">
                        <Skeleton className={cn("h-4 w-10 rounded", bone)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
            <div className={cn("flex flex-col overflow-hidden rounded-2xl border shadow-sm", TASK_PANEL_HEIGHT_CLASS, panelBg, border)}>
              <div className={cn("flex items-center justify-between border-b px-6 py-4", border)}>
                <div className="flex items-center gap-2">
                  <Skeleton className={cn("w-4 h-4 rounded", bone)} />
                  <Skeleton className={cn("h-4 w-32 rounded", bone)} />
                  <Skeleton className={cn("h-4 w-6 rounded-full", bone)} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className={cn("h-6 w-12 rounded-full", bone)} />
                    ))}
                  </div>
                  <Skeleton className={cn("h-3 w-16 rounded", bone)} />
                </div>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-4 md:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={cn("flex items-start gap-3 rounded-xl p-3", isDark ? "bg-[#2e3447]" : "bg-slate-50")}>
                    <Skeleton className={cn("mt-0.5 h-3 w-3 rounded-full", bone)} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className={cn("h-4 w-full rounded", bone)} />
                      <div className="flex items-center gap-2">
                        <Skeleton className={cn("h-3 w-16 rounded", bone)} />
                        <Skeleton className={cn("h-3 w-12 rounded", bone)} />
                      </div>
                    </div>
                    <Skeleton className={cn("mt-0.5 h-3 w-12 rounded", bone)} />
                  </div>
                ))}
              </div>
            </div>

            <div className={cn("flex flex-col overflow-hidden rounded-2xl border shadow-sm", TASK_PANEL_HEIGHT_CLASS, panelBg, border)}>
              <div className={cn("flex items-center gap-2 border-b px-6 py-4", border)}>
                <Skeleton className={cn("w-4 h-4 rounded", bone)} />
                <Skeleton className={cn("h-4 w-32 rounded", bone)} />
              </div>
              <div className="flex min-h-0 flex-1 flex-col justify-between p-4">
                <div className="flex flex-col gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Skeleton className={cn("h-2 w-2 shrink-0 rounded-full", bone)} />
                          <Skeleton className={cn("h-3 w-24 rounded", bone)} />
                        </div>
                        <Skeleton className={cn("h-3 w-20 rounded", bone)} />
                      </div>
                      <Skeleton className={cn("h-2 w-full rounded-full", bone)} />
                    </div>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-4 pt-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className={cn("h-3 w-14 rounded", bone)} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={cn("overflow-hidden rounded-2xl border shadow-sm", panelBg, border)}>
            <div className={cn("flex items-center justify-between border-b px-6 py-4", border)}>
              <div className="flex items-center gap-2">
                <Skeleton className={cn("w-4 h-4 rounded", bone)} />
                <Skeleton className={cn("h-4 w-32 rounded", bone)} />
              </div>
              <Skeleton className={cn("h-3 w-16 rounded", bone)} />
            </div>
            <div className="divide-y divide-slate-50">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-6 py-4">
                  <div className="mb-2.5 flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className={cn("h-4 w-32 rounded", bone)} />
                        <Skeleton className={cn("h-4 w-12 rounded-full", bone)} />
                      </div>
                      <Skeleton className={cn("h-3 w-40 rounded", bone)} />
                    </div>
                    <div className="space-y-1 text-right">
                      <Skeleton className={cn("h-4 w-16 rounded", bone)} />
                      <Skeleton className={cn("h-3 w-12 rounded", bone)} />
                    </div>
                  </div>
                  <Skeleton className={cn("h-1.5 w-full rounded-full", bone)} />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
