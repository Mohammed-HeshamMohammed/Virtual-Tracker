"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { canManageTimesheetApprovals } from "@/features/auth"
import { Tab, SetupData } from "@/features/timesheets/components/approvals/types"
import { EMPTY_APPROVAL_MEMBERS } from "@/features/timesheets/components/approvals/data"
import { SetupModal } from "@/features/timesheets/components/approvals/components/SetupModal"
import { TimesheetPreviewCard } from "@/features/timesheets/components/approvals/components/TimesheetPreviewCard"
import { ManualTimeContent } from "@/features/timesheets/components/approvals/components/ManualTimeContent"
import { getMembers, getTimesheets } from "@/infrastructure/api"
import { changedEvent } from "@/infrastructure/api/change-events"

export function TimesheetsApprovalsContent() {
  const { memberRole } = useAuth()
  const canManage = canManageTimesheetApprovals(memberRole)
  const [activeTab, setActiveTab] = useState<Tab>("timesheets")
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [members, setMembers] = useState(EMPTY_APPROVAL_MEMBERS)
  const [timesheetCount, setTimesheetCount] = useState(0)
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

  // Live sync (PLAN-livesyncandagenttimer.md §6.4/case 8): this loader was
  // a one-shot fetchedRef guard - counts never updated again after mount.
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

  const handleSave = (data: SetupData) => {
    if (!canManage) return
    console.log("Setup saved:", data)
  }

  if (!canManage) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <p className="text-sm text-slate-500">You do not have permission to configure timesheet approvals.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900 dark:text-slate-100">
      {/* Tabs */}
      <div className="border-b border-slate-200/80 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("timesheets")}
              className={cn(
                "py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all",
                activeTab === "timesheets"
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              TIMESHEETS
            </button>
            <button
              onClick={() => setActiveTab("manual-time")}
              className={cn(
                "py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-all",
                activeTab === "manual-time"
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              MANUAL TIME REQUESTS
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {activeTab === "timesheets" ? (
            <motion.div
              key="timesheets"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              {/* Header */}
              <div className="text-center max-w-xl mx-auto">
                <h1 className="text-2xl font-normal text-slate-700 mb-4">Timesheet approvals</h1>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Enable timesheet approvals for any team member. They&apos;ll get alerts to submit timesheets after the pay period ends, and managers will be notified to review once they&apos;re ready. Approved timesheets can be paid automatically or manually.
                </p>
                <p className="mt-2 text-xs text-slate-400">Current timesheets in system: {timesheetCount}</p>
              </div>

              {/* Preview Card */}
              <TimesheetPreviewCard member={members[0]} />

              {/* Set it up button */}
              <div className="flex justify-center">
                <button
                  onClick={() => setShowSetupModal(true)}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Set it up
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="manual-time"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ManualTimeContent />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Setup Modal */}
      <SetupModal
        open={showSetupModal}
        members={members}
        onClose={() => setShowSetupModal(false)}
        onSave={handleSave}
      />
    </div>
  )
}
