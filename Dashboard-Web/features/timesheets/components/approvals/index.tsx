"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/shared/utils/utils"
import { useAuth } from "@/shared/providers/app"
import { canManageTimesheetApprovals } from "@/features/auth"
import { Tab, SetupData } from "@/features/timesheets/components/approvals/types"
import { EMPTY_APPROVAL_MEMBERS } from "@/features/timesheets/components/approvals/data"
import { SetupModal } from "@/features/timesheets/components/approvals/components/SetupModal"
import { SubmitMyTimesheetCard } from "@/features/timesheets/components/approvals/components/SubmitMyTimesheetCard"
import { ManualTimeContent } from "@/features/timesheets/components/approvals/components/ManualTimeContent"
import { getMembers, getTimesheets, approveTimesheet, rejectTimesheet, type Timesheet } from "@/infrastructure/api"
import { saveTimesheetApprovalSetup } from "@/features/timesheets/api/timesheet-api"
import { changedEvent } from "@/infrastructure/api/change-events"

function formatPeriodLabel(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00.000Z`)
  const e = new Date(`${end}T00:00:00.000Z`)
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`
}

function PendingApprovalsQueue({
  members,
}: {
  members: { id: string; name: string }[]
}) {
  const { memberId } = useAuth()
  const [pending, setPending] = useState<Timesheet[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    getTimesheets({ status: "submitted" })
      .then((rows) => setPending(rows))
      .catch(() => setPending([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener(changedEvent("timesheets"), handler)
    return () => window.removeEventListener(changedEvent("timesheets"), handler)
  }, [])

  const nameById = new Map(members.map((m) => [m.id, m.name]))

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id)
    setError(null)
    try {
      const approverId = memberId ?? ""
      if (action === "approve") await approveTimesheet(id, approverId)
      else await rejectTimesheet(id, approverId)
      setPending((rows) => rows.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update timesheet.")
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <p className="text-center text-sm text-slate-400">Loading pending timesheets…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Pending approvals {pending.length > 0 ? `(${pending.length})` : ""}
      </h2>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          No timesheets waiting for approval.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {pending.map((ts) => (
            <div key={ts.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {nameById.get(ts.memberId) ?? "Unknown member"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {formatPeriodLabel(ts.periodStart, ts.periodEnd)} · {ts.totalHours.toFixed(2)}h total
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === ts.id}
                  onClick={() => act(ts.id, "reject")}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === ts.id}
                  onClick={() => act(ts.id, "approve")}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busyId === ts.id ? "…" : "Approve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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

  const [setupError, setSetupError] = useState<string | null>(null)

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

              {setupError ? (
                <p className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-600">
                  {setupError}
                </p>
              ) : null}

              {/* The member's own submit flow - the writer that fills the queue below */}
              <SubmitMyTimesheetCard />

              {/* Real approve/reject queue */}
              <PendingApprovalsQueue members={members} />

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
        onSave={(data) => void handleSave(data)}
      />
    </div>
  )
}
