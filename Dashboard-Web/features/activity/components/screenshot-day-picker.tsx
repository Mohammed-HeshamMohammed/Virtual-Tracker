"use client"

import { useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ReportCalendarGrid } from "@/features/reports/components/time-activity-report/calendar-grid"

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

interface ScreenshotDayPickerProps {
  selectedDay: Date
  onSelectDay: (day: Date) => void
  onClose: () => void
}

export function ScreenshotDayPicker({ selectedDay, onSelectDay, onClose }: ScreenshotDayPickerProps) {
  const today = startOfDay(new Date())
  const [year, setYear] = useState(selectedDay.getFullYear())
  const [month, setMonth] = useState(selectedDay.getMonth())
  const [hovered, setHovered] = useState<Date | null>(null)

  const handleSelect = (d: Date) => {
    const day = startOfDay(d)
    if (day.getTime() > today.getTime()) return
    onSelectDay(day)
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className="absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
    >
      <ReportCalendarGrid
        year={year}
        month={month}
        onMonthChange={(y, m) => {
          setYear(y)
          setMonth(m)
        }}
        start={selectedDay}
        end={selectedDay}
        hovered={hovered}
        onSelect={handleSelect}
        onHover={setHovered}
      />
    </motion.div>
  )
}

interface ScreenshotDayPickerPopoverProps {
  open: boolean
  selectedDay: Date
  onSelectDay: (day: Date) => void
  onClose: () => void
  children: ReactNode
}

export function ScreenshotDayPickerPopover({
  open,
  selectedDay,
  onSelectDay,
  onClose,
  children,
}: ScreenshotDayPickerPopoverProps) {
  return (
    <div className="relative">
      {children}
      <AnimatePresence>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close calendar"
              onClick={onClose}
            />
            <ScreenshotDayPicker selectedDay={selectedDay} onSelectDay={onSelectDay} onClose={onClose} />
          </>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
