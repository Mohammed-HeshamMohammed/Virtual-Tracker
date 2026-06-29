"use client"

import type { ReactNode } from "react"
import { Skeleton } from "@/shared/ui/skeleton"
import { cn } from "@/shared/utils/utils"
import type { MemberManageTab } from "@/features/members/models/member"

const BONE = "bg-slate-200"

function FieldSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Skeleton className={cn("h-3 w-20 rounded", BONE)} />
      <Skeleton className={cn("h-10 w-full rounded-lg", BONE)} />
    </div>
  )
}

function SectionSkeleton({ titleWidth, children }: { titleWidth: string; children: ReactNode }) {
  return (
    <section>
      <Skeleton className={cn("mb-3 h-4 rounded", BONE, titleWidth)} />
      {children}
    </section>
  )
}

/** Default tab skeleton — mirrors Info tab field layout. */
function InfoTabSkeleton() {
  return (
    <>
      <SectionSkeleton titleWidth="w-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSkeleton />
          <FieldSkeleton />
          <div className="space-y-1.5 sm:col-span-2">
            <Skeleton className={cn("h-3 w-12 rounded", BONE)} />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className={cn("h-10 w-full rounded-lg", BONE)} />
              <Skeleton className={cn("h-10 w-full rounded-lg", BONE)} />
            </div>
          </div>
          <FieldSkeleton className="sm:col-span-2" />
        </div>
      </SectionSkeleton>

      <SectionSkeleton titleWidth="w-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSkeleton className="sm:col-span-2" />
        </div>
      </SectionSkeleton>
    </>
  )
}

function GenericTabSkeleton() {
  return (
    <SectionSkeleton titleWidth="w-24">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldSkeleton />
        <FieldSkeleton />
        <FieldSkeleton className="sm:col-span-2" />
      </div>
    </SectionSkeleton>
  )
}

interface MemberManageModalSkeletonProps {
  activeTab?: MemberManageTab
}

/** Placeholder while member profile loads inside the manage-member modal. */
export function MemberManageModalSkeleton({ activeTab = "info" }: MemberManageModalSkeletonProps) {
  return (
    <div
      className="animate-pulse space-y-6"
      aria-busy="true"
      aria-label="Loading member profile"
      role="status"
    >
      {activeTab === "info" ? <InfoTabSkeleton /> : <GenericTabSkeleton />}
    </div>
  )
}
