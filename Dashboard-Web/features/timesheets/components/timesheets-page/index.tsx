"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/shared/providers/app"
import { canManageTimesheetApprovals } from "@/features/auth"
import type { SetupData } from "@/features/timesheets/components/approvals/types"
import { EMPTY_APPROVAL_MEMBERS } from "@/features/timesheets/components/approvals/data"
import { SetupModal } from "@/features/timesheets/components/approvals/components/SetupModal"
import { SubmitMyTimesheetCard } from "@/features/timesheets/components/approvals/components/SubmitMyTimesheetCard"
import { PendingApprovalsQueue } from "@/features/timesheets/components/approvals/components/PendingApprovalsQueue"
import { getMembers, getTimesheets } from "@/infrastructure/api"
import { saveTimesheetApprovalSetup } from "@/features/timesheets/api/timesheet-api"
import { changedEvent } from "@/infrastructure/api/change-events"

export function TimesheetsPage() {
  const { memberRole } = useAuth()
  const canManage = canManageTimesheetApprovals(memberRole)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [members, setMembers] = useState(EMPTY_APPROVAL_MEMBERS)
  const [timesheetCount, setTimesheetCount] = useState(0)
  const [setupError, setSetupError] = useState<string | null>(null)
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
    getTimesheets()
      .then((rows: any[]) => setTimesheetCount(Array.isArray(rows) ? rows.length : 0))
      .catch(() => {})
  }, [canManage])

  useEffect(() => {
    if (!canManage) return
    const handler = () => {
      void getTimesheets()
        .then((rows: any[]) => setTimesheetCount(Array.isArray(rows) ? rows.length : 0))
        .catch(() => {})
    }
    window.addEventListener(changedEvent("timesheets"), handler)
    return () => window.removeEventListener(changedEvent("timesheets"), handler)
  }, [canManage])

  const handleSave = async (data: SetupData) => {
    if (!canManage) return
    setSetupError(null)
    try {
      await saveTimesheetApprovalSetup({
        memberIds: data.members,
        payPeriod: data.payPeriod,
        autoSetup: data.autoSetup,
      })
      setShowSetupModal(false)
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Failed to save timesheet approval settings.")
    }
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900 dark:text-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="text-center max-w-xl mx-auto">
          <h1 className="text-2xl font-normal text-slate-700 mb-4">Timesheets</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Submit your own timesheet at the end of each pay period. Enable approvals for any team member to get
            alerts to submit, and be notified to review once they&apos;re ready.
          </p>
          {canManage ? <p className="mt-2 text-xs text-slate-400">Current timesheets in system: {timesheetCount}</p> : null}
        </div>

        {setupError ? (
          <p className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-600">
            {setupError}
          </p>
        ) : null}

        <SubmitMyTimesheetCard />

        {canManage ? (
          <>
            <PendingApprovalsQueue members={members} />
            <div className="flex justify-center">
              <button
                onClick={() => setShowSetupModal(true)}
                className="px-6 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
              >
                Set it up
              </button>
            </div>
          </>
        ) : null}
      </div>

      <SetupModal
        open={showSetupModal}
        members={members}
        onClose={() => setShowSetupModal(false)}
        onSave={(data) => void handleSave(data)}
      />
    </div>
  )
}
