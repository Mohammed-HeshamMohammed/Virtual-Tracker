"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { CALENDAR_DAY_NAMES, CALENDAR_MONTHS } from "@/features/reports/components/shared/constants"
import { cn } from "@/shared/utils/utils"
import { getDaysInMonth, getFirstDayOfWeek, isBetween, sameDay } from "@/features/reports/utils/time-and-activity"

export function ReportCalendarGrid({
  year,
  month,
  onMonthChange,
  start,
  end,
  hovered,
  onSelect,
  onHover,
}: {
  year: number
  month: number
  onMonthChange: (y: number, m: number) => void
  start: Date | null
  end: Date | null
  hovered: Date | null
  onSelect: (d: Date) => void
  onHover: (d: Date | null) => void
}) {
  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)
  const prevDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1)
  const effectiveEnd = end ?? hovered

  const allCells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < firstDow; i++) {
    const day = prevDays - firstDow + 1 + i
    allCells.push({
      date: new Date(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, day),
      inMonth: false,
    })
  }
  for (let i = 1; i <= daysInMonth; i++) {
    allCells.push({ date: new Date(year, month, i), inMonth: true })
  }
  const remaining = 42 - allCells.length
  for (let i = 1; i <= remaining; i++) {
    allCells.push({
      date: new Date(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, i),
      inMonth: false,
    })
  }

  return (
    <div className="flex min-w-[280px] flex-col h-full">
      <div className="mb-4 flex items-center justify-between px-1">
        <button
          onClick={() => onMonthChange(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)}
          className="rounded p-1 transition-colors hover:bg-slate-100" type="button"
        >
          <ChevronLeft className="h-4 w-4 text-slate-500" />
        </button>
        <span className="text-sm font-semibold">
          <span className="text-blue-500">{CALENDAR_MONTHS[month]}</span>{" "}
          <span className="text-slate-600">{year}</span>
        </span>
        <button
          onClick={() => onMonthChange(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)}
          className="rounded p-1 transition-colors hover:bg-slate-100" type="button"
        >
          <ChevronRight className="h-4 w-4 text-slate-500" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7">
        {CALENDAR_DAY_NAMES.map((n) => (
          <div key={n} className="py-1 text-center text-xs font-semibold text-slate-600">
            {n}
          </div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7">
        {allCells.map((cell, i) => {
          const isStart = sameDay(cell.date, start)
          const isEnd = sameDay(cell.date, effectiveEnd ?? null)
          const inRange = isBetween(cell.date, start, effectiveEnd)
          const isToday = sameDay(cell.date, new Date())
          return (
            <div
              key={`${cell.date.toISOString()}-${i}`}
              className={cn(
                "relative flex flex-1 cursor-pointer items-center justify-center text-sm transition-colors",
                !cell.inMonth && "opacity-30",
                inRange && "bg-blue-100",
                (isStart || isEnd) && "bg-blue-500",
                isStart && "rounded-l-full",
                isEnd && "rounded-r-full"
              )}
              onClick={() => cell.inMonth && onSelect(cell.date)}
              onMouseEnter={() => onHover(cell.date)}
              onMouseLeave={() => onHover(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm",
                  isStart || isEnd
                    ? "font-semibold text-white"
                    : cell.inMonth
                      ? "text-slate-700 hover:bg-blue-100"
                      : "text-slate-400",
                  isToday && !isStart && !isEnd && "font-bold"
                )}
              >
                {cell.date.getDate()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

