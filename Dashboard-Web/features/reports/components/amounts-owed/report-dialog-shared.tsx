"use client"

import type { ReactNode } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select"
import { REPORT_FILE_TYPE_OPTIONS } from "@/features/reports/components/shared/constants"

export function ReportModalFieldLabel({
  children,
  required,
}: {
  children: ReactNode
  required?: boolean
}) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
      {children}
      {required ? <span>*</span> : null}
    </div>
  )
}

export function ReportFileTypeSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-auto min-h-9 w-full border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-left shadow-xs">
        <SelectValue placeholder="PDF" />
      </SelectTrigger>
      <SelectContent className="z-100 max-h-72 overflow-y-auto scrollbar-hide">
        {REPORT_FILE_TYPE_OPTIONS.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

