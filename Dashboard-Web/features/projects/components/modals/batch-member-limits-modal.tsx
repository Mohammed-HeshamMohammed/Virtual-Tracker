"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Info, SkipForward, X } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { MultiSelectField } from "@/shared/ui/forms/multi-select-field"
import { getProjectFormConfig } from "@/features/projects/api/project-form-api"
import { memberOptionsToSelect } from "@/features/projects/components/add-project-dynamic-fields"
import {
  applyMemberLimitToProjects,
  type BatchMemberLimitResult,
} from "@/features/projects/api/project-details-api"

export function BatchMemberLimitsModal({
  open,
  projects,
  actorMemberId,
  isDark = false,
  onClose,
  onApplied,
}: {
  open: boolean
  projects: { id: string; name: string }[]
  actorMemberId?: string
  isDark?: boolean
  onClose: () => void
  onApplied?: () => void
}) {
  const [memberOptions, setMemberOptions] = useState<{ label: string; value: string; meta?: React.ReactNode }[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [amount, setAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<BatchMemberLimitResult[] | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedMemberIds([])
    setAmount("")
    setError(null)
    setBusy(false)
    setResults(null)
    setOptionsLoading(true)
    setOptionsError(null)
    let cancelled = false
    getProjectFormConfig()
      .then((config) => {
        if (cancelled) return
        setMemberOptions(memberOptionsToSelect(config.options.members))
      })
      .catch((err) => {
        if (cancelled) return
        setOptionsError(err instanceof Error ? err.message : "Failed to load members.")
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const projectIds = projects.map((p) => p.id)
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))
  const parsedAmount = Number(amount)
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (selectedMemberIds.length === 0) {
      setError("Pick at least one member.")
      return
    }
    if (!amountValid) {
      setError("Enter an amount greater than 0.")
      return
    }
    setBusy(true)
    try {
      const outcome = await applyMemberLimitToProjects({
        projectIds,
        memberIds: selectedMemberIds,
        amount: parsedAmount,
        actorMemberId,
      })
      setResults(outcome)
      if (outcome.some((r) => r.status === "applied")) onApplied?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply the limit.")
    } finally {
      setBusy(false)
    }
  }

  const appliedCount = results?.filter((r) => r.status === "applied").length ?? 0
  const skippedCount = results?.filter((r) => r.status === "skipped").length ?? 0
  const errorCount = results?.filter((r) => r.status === "error").length ?? 0

  return (
    <div
      className="fixed inset-0 z-600 flex items-center justify-center bg-black/40 p-4"
      aria-label="Set member limits"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className={cn(
          "flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border shadow-xl",
          isDark ? "border-[#3d4a3d]/40 bg-[#151b2d] text-[#dce1fb]" : "border-slate-200 bg-white text-slate-900",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold">Set member limits</h2>
            <p className={cn("mt-1 text-sm", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
              Apply one amount to selected members across {projects.length} project{projects.length === 1 ? "" : "s"}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn("rounded-lg p-1", isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-400 hover:bg-slate-100")}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {results ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {appliedCount} applied
                </span>
                {skippedCount > 0 ? (
                  <span className={cn("inline-flex items-center gap-1.5", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                    <SkipForward className="h-4 w-4" /> {skippedCount} skipped
                  </span>
                ) : null}
                {errorCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4" /> {errorCount} failed
                  </span>
                ) : null}
              </div>
              <ul className={cn("divide-y rounded-lg border text-sm", isDark ? "divide-[#2e3447] border-[#2e3447]" : "divide-slate-100 border-slate-200")}>
                {results.map((r) => (
                  <li key={r.projectId} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate font-medium">{projectNameById.get(r.projectId) ?? r.projectId}</span>
                    <span
                      className={cn(
                        "shrink-0 text-right",
                        r.status === "applied"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : r.status === "skipped"
                            ? isDark ? "text-[#bccbb9]" : "text-slate-500"
                            : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {r.status === "applied" ? "Applied" : r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div
                className={cn(
                  "flex gap-2 rounded-lg border px-3 py-2 text-xs",
                  isDark ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9]" : "border-slate-200 bg-slate-50 text-slate-600",
                )}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Applied as hours on projects with an Hours based budget, and as a dollar amount at the
                  project&apos;s own rate on Cost based projects - each project keeps its own unit. Projects with
                  no budget are skipped, since there is nothing for a limit to tighten.
                </span>
              </div>

              <div>
                <label className={cn("mb-1 block text-xs font-semibold uppercase tracking-wide", isDark ? "text-[#bccbb9]" : "text-slate-500")}>
                  Members
                </label>
                {optionsError ? (
                  <p className="text-sm text-rose-500">{optionsError}</p>
                ) : (
                  <MultiSelectField
                    placeholder={optionsLoading ? "Loading members…" : "Select members"}
                    options={memberOptions}
                    selected={selectedMemberIds}
                    onChange={setSelectedMemberIds}
                  />
                )}
              </div>

              <div>
                <label
                  htmlFor="batch-member-limit-amount"
                  className={cn("mb-1 block text-xs font-semibold uppercase tracking-wide", isDark ? "text-[#bccbb9]" : "text-slate-500")}
                >
                  Amount
                </label>
                <input
                  id="batch-member-limit-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2",
                    isDark
                      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#dce1fb] focus:ring-[#4be277]/40"
                      : "border-slate-200 bg-white text-slate-900 focus:ring-blue-500/30",
                  )}
                />
              </div>

              {error ? (
                <p className="text-sm text-rose-500" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className={cn("flex justify-end gap-2 border-t px-6 py-4", isDark ? "border-[#2e3447]" : "border-slate-200")}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium",
              isDark ? "text-[#bccbb9] hover:bg-[#2e3447]" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {results ? "Done" : "Cancel"}
          </button>
          {results ? null : (
            <button
              type="submit"
              disabled={busy || optionsLoading}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
                isDark ? "bg-[#4be277] text-[#0c1324] hover:bg-[#3dd068]" : "bg-blue-600 hover:bg-blue-700",
              )}
            >
              {busy ? "Applying…" : "Apply limit"}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
