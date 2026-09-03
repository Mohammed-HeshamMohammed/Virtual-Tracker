"use client"

import { useEffect, useRef, useState } from "react"
import { Plus } from "lucide-react"
import { useAuth } from "@/shared/providers/app"
import { canManageTimesheetApprovals } from "@/features/auth"
import { ManualTimeContent } from "@/features/timesheets/components/approvals/components/ManualTimeContent"
import { PendingManualTimeQueue } from "@/features/timesheets/components/approvals/components/PendingManualTimeQueue"
import { EMPTY_APPROVAL_MEMBERS } from "@/features/timesheets/components/approvals/data"
import { getMembers } from "@/infrastructure/api"
import { AddManualEntryDialog } from "@/features/reports/components/time-activity-report/add-manual-entry-dialog"

/**
 * Manual time, split from the old combined Approvals page.
 *
 * Same page, different content depending on who's looking - ManualTimeContent
 * itself already reads the viewer's own role to decide its copy (the server
 * independently decides the real outcome regardless), and management gets an
 * extra section below it: everyone else's still-pending requests to review.
 */
export function ManualTimeRequestsPage() {
  const { memberRole } = useAuth()
  const canManage = canManageTimesheetApprovals(memberRole)
  const [members, setMembers] = useState(EMPTY_APPROVAL_MEMBERS)
  const fetchedRef = useRef(false)
  const [addOpen, setAddOpen] = useState(false)

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
            {/* Whoever reviews these requests doesn't need to become one
                themself - a management-role viewer's own entries already
                land pre-approved (resolveTimeEntryStatus, schema/routes.js),
                this just gives that the same reach the Time & Activity
                popup has (any project member, not just yourself) without
                leaving this page. */}
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Add time directly for someone on your team - it lands approved right away, not as a request.
              </p>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-500 dark:bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 dark:hover:bg-emerald-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Add time for someone
              </button>
            </div>
            <PendingManualTimeQueue members={members} />
          </div>
        ) : null}
      </div>

      {canManage ? (
        <AddManualEntryDialog open={addOpen} onOpenChange={setAddOpen} />
      ) : null}
    </div>
  )
}
