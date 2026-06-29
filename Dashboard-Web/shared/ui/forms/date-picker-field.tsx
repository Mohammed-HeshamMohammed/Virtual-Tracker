/* eslint-disable react-doctor/rerender-lazy-state-init */
"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { FLOATING_MENU_ATTR, FLOATING_MENU_Z_CLASS } from "@/shared/ui/forms/floating-menu"

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAY_MO = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
const YEARS_PER_PAGE = 12

type CalendarView = "days" | "months" | "years"

function yearPageStart(year: number) {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE
}

const CALENDAR_WIDTH = 300
const CALENDAR_HEIGHT = 340
const CALENDAR_GAP = 8

function getCalendarPosition(rect: DOMRect) {
  const pad = 8
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = rect.right + CALENDAR_GAP
  if (left + CALENDAR_WIDTH > vw - pad) {
    left = rect.left - CALENDAR_WIDTH - CALENDAR_GAP
  }
  left = Math.max(pad, Math.min(left, vw - CALENDAR_WIDTH - pad))

  let top = rect.top + rect.height / 2 - CALENDAR_HEIGHT / 2
  top = Math.max(pad, Math.min(top, vh - CALENDAR_HEIGHT - pad))

  return { top, left }
}

function getDaysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate()
}

function getFirstDayMonday(y: number, m: number) {
  const d = new Date(y, m, 1).getDay()
  return d === 0 ? 6 : d - 1
}

function parseIsoDate(value: string): Date | null {
  if (!value) return null
  const [y, mo, d] = value.split("-").map(Number)
  if (!y || !mo || !d) return null
  return new Date(y, mo - 1, d)
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function formatDisplay(value: string): string {
  const d = parseIsoDate(value)
  if (!d) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function BlueCalendar({
  value,
  onChange,
  onClose,
}: {
  value: Date | null
  onChange: (iso: string) => void
  onClose: () => void
}) {
  const today = value ?? new Date()
  const [view, setView] = useState<CalendarView>("days")
  const [y, setY] = useState(today.getFullYear())
  const [m, setM] = useState(today.getMonth())
  const [yearStart, setYearStart] = useState(yearPageStart(today.getFullYear()))

  const dim = getDaysInMonth(y, m)
  const fdow = getFirstDayMonday(y, m)
  const prevDim = getDaysInMonth(y, m === 0 ? 11 : m - 1)

  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < fdow; i++) {
    const d =
      m === 0
        ? new Date(y - 1, 11, prevDim - fdow + 1 + i)
        : new Date(y, m - 1, prevDim - fdow + 1 + i)
    cells.push({ date: d, inMonth: false })
  }
  for (let i = 1; i <= dim; i++) cells.push({ date: new Date(y, m, i), inMonth: true })
  const rem = 42 - cells.length
  for (let i = 1; i <= rem; i++) {
    cells.push({
      date: m === 11 ? new Date(y + 1, 0, i) : new Date(y, m + 1, i),
      inMonth: false,
    })
  }

  function navPrev() {
    if (view === "days") {
      if (m === 0) {
        setY((v) => v - 1)
        setM(11)
      } else setM((v) => v - 1)
    } else if (view === "months") {
      setY((v) => v - 1)
    } else {
      setYearStart((v) => v - YEARS_PER_PAGE)
    }
  }

  function navNext() {
    if (view === "days") {
      if (m === 11) {
        setY((v) => v + 1)
        setM(0)
      } else setM((v) => v + 1)
    } else if (view === "months") {
      setY((v) => v + 1)
    } else {
      setYearStart((v) => v + YEARS_PER_PAGE)
    }
  }

  const isDaySelected = (d: Date) =>
    !!value &&
    d.getFullYear() === value.getFullYear() &&
    d.getMonth() === value.getMonth() &&
    d.getDate() === value.getDate()

  const isMonthSelected = (monthIndex: number) =>
    !!value && value.getFullYear() === y && value.getMonth() === monthIndex

  const isYearSelected = (year: number) => !!value && value.getFullYear() === year

  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearStart + i)

  const navLabel =
    view === "days" ? "month" : view === "months" ? "year" : `${YEARS_PER_PAGE} years`

  return (
    <div className="w-[300px] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg">
      <div className="flex items-center justify-between px-4 py-3" style={{ background: "#1e88e5" }}>
        <button
          type="button"
          onClick={navPrev}
          className="rounded p-1 transition-colors hover:bg-white/20"
          aria-label={`Previous ${navLabel}`}
        >
          <ChevronLeft className="h-4 w-4 text-white" />
        </button>
        <div className="flex items-center gap-1 text-sm font-bold text-white">
          {view === "years" ? (
            <span>
              {yearStart} – {yearStart + YEARS_PER_PAGE - 1}
            </span>
          ) : view === "months" ? (
            <button
              type="button"
              onClick={() => {
                setYearStart(yearPageStart(y))
                setView("years")
              }}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/20"
            >
              {y}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setView("months")}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/20"
              >
                {MONTHS_FULL[m].slice(0, 3)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setYearStart(yearPageStart(y))
                  setView("years")
                }}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/20"
              >
                {y}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={navNext}
          className="rounded p-1 transition-colors hover:bg-white/20"
          aria-label={`Next ${navLabel}`}
        >
          <ChevronRight className="h-4 w-4 text-white" />
        </button>
      </div>

      <div className="min-h-[252px] bg-white">
        {view === "days" && (
          <>
            <div className="grid grid-cols-7" style={{ background: "#e3f2fd" }}>
              {DAY_MO.map((n) => (
                <div
                  key={n}
                  className={cn(
                    "py-2 text-center text-xs font-semibold",
                    n === "Su" ? "text-blue-300" : "text-blue-500",
                  )}
                >
                  {n}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 p-1">
              {cells.map((cell, i) => (
                <button
                  key={`${cell.date.toISOString()}-${i}`}
                  type="button"
                  disabled={!cell.inMonth}
                  onClick={() => {
                    if (!cell.inMonth) return
                    onChange(toIsoDate(cell.date))
                    onClose()
                  }}
                  className={cn(
                    "mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors",
                    isDaySelected(cell.date)
                      ? "bg-blue-500 font-bold text-white"
                      : !cell.inMonth
                        ? "cursor-default text-slate-300"
                        : "cursor-pointer text-slate-700 hover:bg-blue-50",
                  )}
                >
                  {cell.date.getDate()}
                </button>
              ))}
            </div>
          </>
        )}

        {view === "months" && (
          <div className="grid grid-cols-3 gap-1 p-3">
            {MONTHS_SHORT.map((label, monthIndex) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setM(monthIndex)
                  setView("days")
                }}
                className={cn(
                  "rounded-lg py-2.5 text-sm font-medium transition-colors",
                  isMonthSelected(monthIndex)
                    ? "bg-blue-500 text-white"
                    : "text-slate-700 hover:bg-blue-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {view === "years" && (
          <div className="grid grid-cols-3 gap-1 p-3">
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => {
                  setY(year)
                  setView("months")
                }}
                className={cn(
                  "rounded-lg py-2.5 text-sm font-medium transition-colors",
                  isYearSelected(year)
                    ? "bg-blue-500 text-white"
                    : "text-slate-700 hover:bg-blue-50",
                )}
              >
                {year}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function DatePickerField({
  value,
  onChange,
  placeholder = "Select date",
}: {
  value: string
  onChange: (iso: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = parseIsoDate(value)
  const display = formatDisplay(value)
  const theme = useClientFormTheme()

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (triggerRef.current) {
        setPosition(getCalendarPosition(triggerRef.current.getBoundingClientRect()))
      }
    }
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [open])

  function toggle() {
    if (triggerRef.current) {
      setPosition(getCalendarPosition(triggerRef.current.getBoundingClientRect()))
    }
    setOpen((v) => !v)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={cn(
          theme.control,
          "flex items-center justify-between hover:bg-slate-50/80",
          open && theme.controlOpen,
        )}
      >
        <span
          className={
            display
              ? theme.isDark
                ? "text-[#dce1fb]"
                : "text-slate-700"
              : theme.isDark
                ? "text-[#bccbb9]/50"
                : "text-slate-400"
          }
        >
          {display || placeholder}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={cn("fixed inset-0 pointer-events-none", FLOATING_MENU_Z_CLASS)}>
            <div
              className="absolute inset-0 pointer-events-auto"
              aria-hidden
              onMouseDown={() => setOpen(false)}
            />
            <div
              ref={menuRef}
              {...{ [FLOATING_MENU_ATTR]: "" }}
              onMouseDown={(e) => e.stopPropagation()}
              className="pointer-events-auto fixed"
              style={{
                top: position.top,
                left: position.left,
              }}
            >
              <BlueCalendar
                value={selected}
                onChange={onChange}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
