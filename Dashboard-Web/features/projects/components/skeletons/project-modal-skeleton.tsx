"use client"

import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import { FORM_GRID, FORM_STACK } from "@/shared/ui/forms/form-styles"

interface ProjectModalSkeletonProps {
  isDark?: boolean
  activeTab: string
  budgetSubTab?: "project-budget" | "member-limits"
}

function FieldSkeleton({ bone, className }: { bone: string; className?: string }) {
  return (
    <div className={className}>
      <Skeleton className={cn("mb-2 h-3 w-20 rounded", bone)} />
      <Skeleton className={cn("h-10 w-full rounded-lg", bone)} />
    </div>
  )
}

function ToggleCardSkeleton({ bone }: { bone: string }) {
  return (
    <div className={cn("space-y-3 rounded-xl border p-3", isDarkBorder(bone))}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className={cn("h-4 w-40 rounded", bone)} />
          <Skeleton className={cn("h-6 w-11 shrink-0 rounded-full", bone)} />
        </div>
      ))}
    </div>
  )
}

function isDarkBorder(bone: string) {
  return bone.includes("#2e") ? "border-[#2e3447]" : "border-slate-200"
}

export function ProjectModalSkeleton({
  isDark = false,
  activeTab,
  budgetSubTab = "project-budget",
}: ProjectModalSkeletonProps) {
  const bone = isDark ? "bg-[#2e3447]" : "bg-slate-200"

  if (activeTab === "members-teams" || activeTab === "members") {
    return (
      <div className={cn(FORM_STACK, "animate-pulse")} aria-hidden>
        {Array.from({ length: 2 }).map((_, i) => (
          <FieldSkeleton key={i} bone={bone} />
        ))}
        {activeTab === "members-teams" ? <FieldSkeleton bone={bone} /> : null}
      </div>
    )
  }

  if (activeTab === "teams") {
    return (
      <div className={cn(FORM_STACK, "animate-pulse")} aria-hidden>
        <FieldSkeleton bone={bone} />
      </div>
    )
  }

  if (activeTab === "budget") {
    return (
      <div className={cn(FORM_STACK, "animate-pulse")} aria-hidden>
        <Skeleton className={cn("h-10 w-full max-w-md rounded-full", bone)} />
        {budgetSubTab === "project-budget" ? (
          <>
            <div className={FORM_GRID}>
              <FieldSkeleton bone={bone} />
              <FieldSkeleton bone={bone} />
              <FieldSkeleton bone={bone} className="sm:col-span-2" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className={cn("h-4 w-44 rounded", bone)} />
              <Skeleton className={cn("h-6 w-11 shrink-0 rounded-full", bone)} />
            </div>
            <div className={FORM_GRID}>
              <FieldSkeleton bone={bone} />
              <FieldSkeleton bone={bone} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className={cn("h-4 w-56 rounded", bone)} />
              <Skeleton className={cn("h-6 w-11 shrink-0 rounded-full", bone)} />
            </div>
            <FieldSkeleton bone={bone} className="max-w-xs" />
            <div className={FORM_GRID}>
              <FieldSkeleton bone={bone} />
              <FieldSkeleton bone={bone} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className={cn("h-4 w-40 rounded", bone)} />
              <Skeleton className={cn("h-6 w-11 shrink-0 rounded-full", bone)} />
            </div>
          </>
        ) : (
          <>
            <Skeleton className={cn("h-4 w-full max-w-2xl rounded", bone)} />
            <FieldSkeleton bone={bone} className="max-w-xs" />
            <div className="flex items-center justify-between gap-3">
              <Skeleton className={cn("h-4 w-40 rounded", bone)} />
              <Skeleton className={cn("h-6 w-11 shrink-0 rounded-full", bone)} />
            </div>
            <div className={cn("rounded-xl border p-4", isDarkBorder(bone))}>
              <div className={FORM_GRID}>
                <FieldSkeleton bone={bone} />
                <FieldSkeleton bone={bone} />
                <FieldSkeleton bone={bone} className="sm:col-span-2" />
                <FieldSkeleton bone={bone} />
                <FieldSkeleton bone={bone} />
              </div>
            </div>
            <Skeleton className={cn("h-4 w-32 rounded", bone)} />
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn(FORM_STACK, "animate-pulse")} aria-hidden>
      <FieldSkeleton bone={bone} />
      <ToggleCardSkeleton bone={bone} />
      <div className={FORM_GRID}>
        <FieldSkeleton bone={bone} />
        <FieldSkeleton bone={bone} />
      </div>
    </div>
  )
}
