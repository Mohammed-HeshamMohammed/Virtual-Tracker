"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/shared/ui/dialog"
import { cn } from "@/shared/utils/utils"

interface TaskReviewModalProps {
  open: boolean
  onClose: () => void
  onSave: (decision: "approved" | "rejected") => Promise<void>
  isDark: boolean
}

export function TaskReviewModal({
  open,
  onClose,
  onSave,
  isDark,
}: TaskReviewModalProps) {
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved")
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setReviewDecision("approved")
      setReviewError(null)
      setIsSaving(false)
    }
  }

  async function handleSubmit() {
    setIsSaving(true)
    setReviewError(null)

    try {
      await onSave(reviewDecision)
      onClose()
    } catch (error: any) {
      setReviewError(error instanceof Error ? error.message : "Failed to submit review")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn("max-w-md", isDark ? "bg-[#151b2d] border-[#2e3447] text-[#dce1fb]" : "")}>
        <DialogHeader>
          <DialogTitle>Review Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <label className={cn("text-xs font-semibold text-slate-500", isDark && "text-slate-400")} htmlFor="fallback-id">
              REVIEW DECISION
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setReviewDecision("approved")}
                className={cn(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                  reviewDecision === "approved"
                    ? "bg-green-600 border-green-600 text-white"
                    : isDark
                    ? "border-[#2e3447] text-[#dce1fb] hover:bg-[#2e3447]"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setReviewDecision("rejected")}
                className={cn(
                  "flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                  reviewDecision === "rejected"
                    ? "bg-red-600 border-red-600 text-white"
                    : isDark
                    ? "border-[#2e3447] text-[#dce1fb] hover:bg-[#2e3447]"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                Reject
              </button>
            </div>
          </div>
          {reviewError && (
            <div className="text-sm text-red-500">{reviewError}</div>
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
              reviewDecision === "approved"
                ? "bg-green-600 hover:bg-green-700 disabled:opacity-50"
                : "bg-red-600 hover:bg-red-700 disabled:opacity-50",
            )}
          >
            {isSaving ? "Submitting…" : reviewDecision === "approved" ? "Approve Task" : "Reject Task"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
