/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useState as useComponentState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { DATE_RANGE_PRESETS } from "@/features/reports/components/shared/constants"
import { computePresetRange, formatRangeLabel } from "@/features/reports/utils/time-and-activity"
import { cn } from "@/shared/utils/utils"
import { ReportCalendarGrid } from "@/features/reports/components/time-activity-report/calendar-grid"

export function ReportDateRangePicker({
  onApply,
  onDismiss,
  /** When true, dropdown’s right edge aligns with the anchor (extends left). */
  anchorEnd = false,
  initialStart,
  initialEnd,
  /** Optional: receive parsed range when user applies (for controlled navigation). */
  onApplyRange,
}: {
  onApply: (label: string) => void
  onDismiss: () => void
  anchorEnd?: boolean
  initialStart?: Date | null
  initialEnd?: Date | null
  onApplyRange?: (start: Date, end: Date) => void
}) {
  const seedStart = initialStart ?? new Date(2026, 2, 16)
  const seedEnd = initialEnd ?? new Date(2026, 2, 22)
  const [leftYear, setLeftYear] = useComponentState(seedStart.getFullYear())
  const [leftMonth, setLeftMonth] = useComponentState(seedStart.getMonth())
  const [start, setStart] = useComponentState<Date | null>(seedStart)
  const [end, setEnd] = useComponentState<Date | null>(seedEnd)
  const [hovered, setHovered] = useComponentState<Date | null>(null)

  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1

  function handleSelect(d: Date) {
    if (!start || (start && end)) {
      setStart(d)
      setEnd(null)
    } else {
      if (d < start) {
        setEnd(start)
        setStart(d)
      } else setEnd(d)
    }
  }

  function handleMonthChange(y: number, m: number) {
    setLeftYear(y)
    setLeftMonth(m)
  }

  function formatRange() {
    if (!start) return "Select range"
    return formatRangeLabel(start, end)
  }

  function applyPreset(preset: string) {
    const r = computePresetRange(preset)
    if (!r) return
    setStart(r.start)
    setEnd(r.end)
    setLeftYear(r.start.getFullYear())
    setLeftMonth(r.start.getMonth())
    onApplyRange?.(r.start, r.end)
    onApply(formatRangeLabel(r.start, r.end))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "absolute top-full z-55 mt-1 flex overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl",
        anchorEnd ? "right-0 left-auto" : "left-0"
      )}
      style={{ minWidth: 700 }}
    >
      <div className="flex min-w-[130px] flex-col gap-1 border-r border-slate-100 p-4">
        {DATE_RANGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className="whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100"
          >
            {p}
          </button>
        ))}
      </div>
      <div className="space-y-3 p-5">
        <div className="flex gap-8">
          <ReportCalendarGrid
            year={leftYear}
            month={leftMonth}
            onMonthChange={handleMonthChange}
            start={start}
            end={end}
            hovered={hovered}
            onSelect={handleSelect}
            onHover={setHovered}
          />
          <ReportCalendarGrid
            year={rightYear}
            month={rightMonth}
            onMonthChange={(y, m) => {
              setLeftYear(m === 0 ? y - 1 : y)
              setLeftMonth(m === 0 ? 11 : m - 1)
            }}
            start={start}
            end={end}
            hovered={hovered}
            onSelect={handleSelect}
            onHover={setHovered}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-4 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (start) {
                const e = end ?? start
                onApplyRange?.(start, e)
                onApply(formatRange())
              }
            }}
            className="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white transition-colors hover:bg-blue-600"
          >
            Apply
          </button>
        </div>
      </div>
    </motion.div>
  )
}

