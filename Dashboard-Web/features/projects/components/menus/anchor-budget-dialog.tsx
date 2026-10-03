"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { anchorProjectBudget } from "@/features/projects/api/project-api"

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const inputCls =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-hidden focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500"
const labelCls = "mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300"

export function AnchorBudgetDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const [startDate, setStartDate] = useState(todayLocal)
  const [endDate, setEndDate] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStartDate(todayLocal())
    setEndDate("")
    setError(null)
  }, [open])

  async function submit() {
    setError(null)
    if (!startDate) {
      setError("Pick the day to restart from.")
      return
    }
    if (endDate && endDate < startDate) {
      setError("End date can't be before the start date.")
      return
    }
    setSaving(true)
    try {
      await anchorProjectBudget(projectId, { startDate, endDate: endDate || null })
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restart the budget period.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Restart budget period</DialogTitle>
          <DialogDescription>
            Start {projectName || "this project"}&apos;s budget counting again from this day. If it resets weekly
            or monthly, later periods follow on from it. This is the same &quot;Starts on&quot; as in the
            project&apos;s Budget tab.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="anchor-start" className={labelCls}>
              Start date
            </label>
            <input
              id="anchor-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="anchor-end" className={labelCls}>
              End date <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="anchor-end"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
            />
          </div>
          {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-blue-600"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Restart
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
