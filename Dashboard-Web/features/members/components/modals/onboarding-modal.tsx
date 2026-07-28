/* eslint-disable react-doctor/use-lazy-motion, react-doctor/exhaustive-deps, react-doctor/no-initialize-state */
"use client"

import { useEffect, useMemo, useState as useComponentState } from "react"
import { motion } from "framer-motion"
import { X, Check, Info, Send, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { Toggle } from "@/shared/ui/toggle";
import { getMemberOnboarding, sendMemberOnboardingReminder, type MemberOnboardingRow } from "@/features/members/services/member-onboarding"
import { useAuth } from "@/shared/providers/app"

const ONBOARDING_ROWS_PER_PAGE = 5

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [showOnboarded, setShowOnboarded] = useComponentState(true)
  const [rows, setRows] = useComponentState<MemberOnboardingRow[]>([])
  const [isLoading, setIsLoading] = useComponentState(true)
  const [error, setError] = useComponentState("")
  const [sendingReminderForId, setSendingReminderForId] = useComponentState<string | null>(null)
  const [page, setPage] = useComponentState(0)
  // If the exit animation's deferred unmount ever stalls, this invisible fixed-inset-0
  // backdrop would keep intercepting every click/hover on the dashboard underneath it.
  const [isClosing, setIsClosing] = useComponentState(false)
  const handleClose = () => {
    setIsClosing(true)
    onClose()
  }

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError("")
    getMemberOnboarding()
      .then((next) => {
        if (cancelled) return
        setRows(next)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load onboarding data")
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(
    () =>
      showOnboarded
        ? rows
        : rows.filter((m) => !m.createdAccount || !m.downloadedApp || !m.trackedTime),
    [rows, showOnboarded],
  )

  const totalPages = Math.max(1, Math.ceil(visible.length / ONBOARDING_ROWS_PER_PAGE))
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = visible.slice(
    safePage * ONBOARDING_ROWS_PER_PAGE,
    safePage * ONBOARDING_ROWS_PER_PAGE + ONBOARDING_ROWS_PER_PAGE,
  )
  const rangeStart = visible.length === 0 ? 0 : safePage * ONBOARDING_ROWS_PER_PAGE + 1
  const rangeEnd = Math.min(visible.length, (safePage + 1) * ONBOARDING_ROWS_PER_PAGE)

  useEffect(() => {
    setPage(0)
  }, [showOnboarded, rows.length])

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1))
    }
  }, [page, totalPages])

  async function handleSendReminder(row: MemberOnboardingRow) {
    const allDone = row.createdAccount && row.downloadedApp && row.trackedTime
    if (allDone || sendingReminderForId) return
    setSendingReminderForId(row.id)
    setError("")
    try {
      const updated = await sendMemberOnboardingReminder(row.id, user?.uid)
      setRows((prev) =>
        prev.map((it) =>
          it.id === row.id || it.email.toLowerCase() === row.email.toLowerCase()
            ? { ...it, ...updated, email: row.email }
            : it,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reminder")
    } finally {
      setSendingReminderForId(null)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4",
        isClosing && "pointer-events-none",
      )}
      onClick={handleClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-8 pt-7 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Team onboarding</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              See the progress of members invited via email and send reminders to help them get fully onboarded.
            </p>
          </div>
          <button onClick={handleClose} className="mt-1 rounded-lg p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800" type="button">
            <X className="h-5 w-5 text-slate-400 dark:text-slate-500" />
          </button>
        </div>

        <div className="flex items-center gap-3 px-8 pb-4">
          <Toggle checked={showOnboarded} onChange={() => setShowOnboarded((v) => !v)} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Show onboarded members</span>
        </div>

        <div className="px-8 pb-2">
          {error ? (
            <div className="mb-3 rounded-lg border border-red-100 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}
          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Loading onboarding data…</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      {["Member email", "Created account", "Downloaded app", "Tracked time", "Send reminder"].map((h, i) => (
                        <th
                          key={h}
                          className={cn("py-2.5 text-sm font-normal text-slate-500 dark:text-slate-400", i === 0 ? "text-left" : "text-center")}
                        >
                          <div className={cn("flex items-center gap-1", i === 4 || i > 0 ? "justify-center" : "")}>
                            {h}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {pageRows.map((m) => {
                      const allDone = m.createdAccount && m.downloadedApp && m.trackedTime
                      const isSending = sendingReminderForId === m.id
                      return (
                        <tr key={m.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                          <td className="py-3.5 text-sm text-slate-700 dark:text-slate-200">{m.email}</td>
                          {([m.createdAccount, m.downloadedApp, m.trackedTime] as boolean[]).map((done, i) => (
                            <td key={`${m.id}-step-${i}`} className="py-3.5 text-center">
                              {done ? (
                                <Check className="mx-auto h-5 w-5 text-emerald-500" />
                              ) : (
                                <X className="mx-auto h-5 w-5 text-red-400" />
                              )}
                            </td>
                          ))}
                          <td className="py-3.5 text-center">
                            <IconTooltip
                              text={allDone ? "Member is fully onboarded" : "Send reminder"}
                              placement="top"
                            >
                              <button
                                onClick={() => void handleSendReminder(m)}
                                disabled={allDone || isSending}
                                aria-label={allDone ? "Member is fully onboarded" : "Send reminder"}
                                className={cn(
                                  "mx-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed",
                                  allDone || isSending ? "text-slate-300 dark:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800" : "text-blue-500 dark:text-emerald-400 hover:bg-blue-50 dark:hover:bg-emerald-950/60",
                                )}
                                type="button"
                              >
                                <Send className="h-4 w-4" />
                              </button>
                            </IconTooltip>
                          </td>
                        </tr>
                      )
                    })}
                    {!visible.length ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                          No onboarding rows found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {visible.length > ONBOARDING_ROWS_PER_PAGE ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Showing {rangeStart}–{rangeEnd} of {visible.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Page {safePage + 1} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 px-8 pb-6 pt-3">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <p>Team members can currently track time in several ways.</p>
            </div>
            <p className="pl-6">
              You can adjust their{" "}
              <span className="cursor-pointer text-blue-500 dark:text-emerald-400 hover:underline">timer app settings</span> if you&apos;d
              like to record screenshots and activity (desktop app only).
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
