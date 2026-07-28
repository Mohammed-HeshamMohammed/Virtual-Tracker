"use client"

import { ArrowLeft, ArrowRight } from "lucide-react"
import { EMPTY_TIMESHEET_PREVIEW } from "@/features/timesheets/components/approvals/data"
import type { Member } from "@/features/timesheets/components/approvals/types"

type TimesheetPreviewCardProps = {
  member?: Member
}

export function TimesheetPreviewCard({ member }: TimesheetPreviewCardProps) {
  const previewMember = member ?? {
    id: "preview",
    name: "Team member",
    email: "",
    avatar: "TM",
    color: "#64748b",
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden max-w-2xl mx-auto select-none pointer-events-none opacity-90">
      {/* Card Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ backgroundColor: previewMember.color }}
          >
            {previewMember.avatar}
          </div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{previewMember.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <ArrowLeft className="w-3.5 h-3.5" />
            Previous
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            Next
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Timesheet Table */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-6 gap-4 text-center">
          {EMPTY_TIMESHEET_PREVIEW.week.map((day) => (
            <div key={day.day} className="space-y-1">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{day.day}</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">{day.hours}</div>
            </div>
          ))}
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total</div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{EMPTY_TIMESHEET_PREVIEW.total}</div>
          </div>
        </div>
      </div>

      {/* Details Link */}
      <div className="px-6 py-2">
        <span className="text-xs font-medium text-blue-400 dark:text-blue-500 flex items-center gap-1">
          DETAILS
          <ArrowRight className="w-3 h-3" />
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
        <div className="px-6 py-2 text-sm font-medium text-emerald-400 dark:text-emerald-500 border border-emerald-100 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/40 rounded-lg">
          Approve
        </div>
        <div className="px-6 py-2 text-sm font-medium text-red-400 dark:text-red-500 border border-red-100 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/40 rounded-lg">
          Deny
        </div>
      </div>
    </div>
  )
}
