"use client"

import { LayoutList, Network, Share2 } from "lucide-react"
import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { PEOPLE_THEME_DARK as dark, PEOPLE_THEME_LIGHT as light } from "@/shared/ui/shared/constants"

function skeletonTone(isDark: boolean) {
  return isDark ? "bg-[#2e3447]" : "bg-slate-200"
}

function TreeNodeCardSkeleton({ isDark, depth = 0 }: { isDark: boolean; depth?: number }) {
  const tone = skeletonTone(isDark)
  const border = isDark ? "border-[#3d4a3d]/40 bg-[#151b2d]" : "border-slate-200 bg-white"

  return (
    <div className={cn("relative", depth > 0 && "ml-6 pl-4")}>
      <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", border)}>
        <Skeleton className={cn("h-10 w-10 shrink-0 rounded-full", tone)} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className={cn("h-4 w-36 rounded", tone)} />
            <Skeleton className={cn("h-4 w-16 rounded-full", tone)} />
          </div>
          <Skeleton className={cn("h-3 w-48 max-w-full rounded", tone)} />
        </div>
      </div>
    </div>
  )
}

export function MemberTreeContentSkeleton({ isDark = false }: { isDark?: boolean }) {
  const t = isDark ? dark : light

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border p-5",
        t.tableBorder,
        t.tableBg,
      )}
    >
      <div className="space-y-3">
        <TreeNodeCardSkeleton isDark={isDark} />
        <TreeNodeCardSkeleton isDark={isDark} depth={1} />
        <TreeNodeCardSkeleton isDark={isDark} depth={1} />
        <TreeNodeCardSkeleton isDark={isDark} depth={2} />
        <TreeNodeCardSkeleton isDark={isDark} />
      </div>
      <div className="min-h-0 flex-1" aria-hidden="true" />
    </div>
  )
}

function MemberTreeToolbarShell({ isDark }: { isDark: boolean }) {
  const t = isDark ? dark : light

  return (
    <div className={cn("shrink-0 rounded-xl border p-5", t.tableBorder, t.tableBg)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Network className={cn("h-5 w-5", isDark ? "text-[#4be277]" : "text-blue-600")} />
            <h2 className={cn("text-lg font-semibold", isDark ? "text-[#dce1fb]" : "text-slate-900")}>
              Members tree
            </h2>
          </div>
          <p className={cn("mt-1 max-w-2xl text-sm leading-relaxed", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
            Organization-wide hierarchy showing who added whom across the workspace.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className={cn("text-xs", isDark ? "text-[#8a9588]" : "text-slate-400")}>Loading hierarchy…</div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border opacity-50",
              isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-200 bg-white",
            )}
            aria-hidden
          />
          <div
            className={cn(
              "inline-flex rounded-lg border p-0.5 opacity-50",
              isDark ? "border-[#3d4a3d]/40 bg-[#191f31]" : "border-slate-200 bg-slate-100",
            )}
            aria-hidden
          >
            <span className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold", isDark ? "bg-[#151b2d] text-[#dce1fb]" : "bg-white text-slate-900")}>
              <LayoutList className="h-3.5 w-3.5" />
              List
            </span>
            <span className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              <Share2 className="h-3.5 w-3.5" />
              Connections
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MemberTreePageSkeleton({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <MemberTreeToolbarShell isDark={isDark} />
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <MemberTreeContentSkeleton isDark={isDark} />
        </div>
      </div>
    </div>
  )
}
