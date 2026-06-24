/* eslint-disable react-doctor/no-derived-useState */
"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/shared/ui/dialog"
import { cn } from "@/shared/utils/utils"
import { type TaskHours } from "@/infrastructure/api"
import { validateHoursInput } from "@/shared/validation"

interface TaskHoursModalProps {
  open: boolean
  onClose: () => void
  onSave: (hours: number) => Promise<void>
  isDark: boolean
  taskHoursList: TaskHours[]
}

export function TaskHoursModal({
  open,
  onClose,
  onSave,
  isDark,
  taskHoursList,
}: TaskHoursModalProps) {
  const [hoursSpent, setHoursSpent] = useState("")
  const [hoursError, setHoursError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setHoursSpent("")
      setHoursError(null)
      setIsSaving(false)
    }
  }

  async function handleSubmit() {
    if (isSaving) return
    const validationError = validateHoursInput(hoursSpent)
    if (validationError) {
      setHoursError(validationError)
      return
    }
    const hours = Number(hoursSpent)

    setIsSaving(true)
    setHoursError(null)

    try {
      await onSave(hours)
      onClose()
    } catch (error: any) {
      setHoursError(error instanceof Error ? error.message : "Failed to submit hours")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn("max-w-md", isDark ? "bg-[#151b2d] border-[#2e3447] text-[#dce1fb]" : "")}>
        <DialogHeader>
          <DialogTitle>Submit Hours</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")} htmlFor="fallback-id">
              HOURS SPENT
            </label>
            <input
              type="number"
              min={0}
              step={0.25}
              value={hoursSpent}
              onChange={(e) => setHoursSpent(e.target.value)}
              placeholder="e.g. 4.5"
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none",
                isDark ? "border-[#2e3447] bg-[#191f31]" : "border-slate-200 bg-white",
              )} aria-label="Interactive control"
            />
          </div>
          {taskHoursList.length > 0 && (
            <div className="space-y-2">
              <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")}>
                SUBMITTED HOURS
              </label>
              <div className="space-y-1">
                {taskHoursList.map((hours) => (
                  <div key={hours.id} className="flex justify-between text-sm">
                    <span className={isDark ? "text-slate-300" : "text-slate-600"}>{hours.userId}</span>
                    <span className={cn("font-medium", hours.status === "submitted" ? "text-green-600" : "text-slate-500")}>
                      {hours.hoursSpent}h ({hours.status})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hoursError && (
            <div className="text-sm text-red-500">{hoursError}</div>
          )}
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium border",
              isDark ? "border-[#2e3447] hover:bg-[#2e3447] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium text-white",
              "bg-blue-600 hover:bg-blue-700 disabled:opacity-50",
            )}
          >
            {isSaving ? "Submitting…" : "Submit Hours"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
