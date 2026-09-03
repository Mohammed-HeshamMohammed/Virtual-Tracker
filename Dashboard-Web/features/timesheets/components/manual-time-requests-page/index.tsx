"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/shared/providers/app"
import { canManageTimesheetApprovals } from "@/features/auth"
import { ManualTimeContent } from "@/features/timesheets/components/approvals/components/ManualTimeContent"
import { PendingManualTimeQueue } from "@/features/timesheets/components/approvals/components/PendingManualTimeQueue"
import { EMPTY_APPROVAL_MEMBERS } from "@/features/timesheets/components/approvals/data"
import { getMembers } from "@/infrastructure/api"

export function ManualTimeRequestsPage() {
  const { memberRole } = useAuth()
  const canManage = canManageTimesheetApprovals(memberRole)
  const [members, setMembers] = useState(EMPTY_APPROVAL_MEMBERS)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!canManage) return
    if (fetchedRef.current) return
    fetchedRef.current = true
    getMembers()
      .then((rows: any[]) => {
        if (!rows?.length) return
        setMembers(
          rows.map((r) => ({
            id: r.id,
            name: r.name || `${r.first_name || ""} ${r.last_name || ""}`.trim(),
            email: r.email || "",
            avatar: r.avatar || r.name?.slice(0, 2).toUpperCase() || "??",
            color: r.color || "#64748b",
          })),
        )
      })
      .catch(() => {})
  }, [canManage])

  return (
    <div className="min-h-screen bg-transparent text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        <ManualTimeContent />
        {canManage ? (
          <div className="border-t border-slate-200/80 pt-8 dark:border-slate-800 space-y-4">
            <PendingManualTimeQueue members={members} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
