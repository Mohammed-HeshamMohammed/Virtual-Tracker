/* eslint-disable react-doctor/use-lazy-motion */
/* eslint-disable react-doctor/only-export-components */
/* eslint-disable react-doctor/no-multi-comp */
"use client"

import { useState as useComponentState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { MONTHS_FULL, DAY_NAMES, DAY_NAMES_SU } from "@/features/financials/components/shared/constants"

// ─── Utilities ──────────────────────────────────────────────────────────────

function getDIM(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function getFDOW(y: number, m: number, firstDayOfWeek: 0 | 1) {
  const d = new Date(y, m, 1).getDay()
  if (firstDayOfWeek === 1) return d === 0 ? 6 : d - 1 // Mo-first
  return d // Su-first
}
function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function isBetween(d: Date, s: Date | null, e: Date | null) {
  if (!s || !e) return false
  const t = d.getTime()
  return t > Math.min(s.getTime(), e.getTime()) && t < Math.max(s.getTime(), e.getTime())
}
export function fmtShort(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

// ─── Shared Grid ──────────────────────────────────────────────────────────────

interface DateGridProps {
  year: number
  month: number
  onNav: (y: number, m: number) => void
  start?: Date | null
  end?: Date | null
  hover?: Date | null
  onSelect: (d: Date) => void
  onHover?: (d: Date | null) => void
  theme?: "blue" | "white" | "solid-blue"
  firstDayOfWeek?: 0 | 1
  showFooter?: boolean
  singleMode?: boolean
}

function DateGrid({
  year, month, onNav, start, end, hover, onSelect, onHover = () => {},
  theme = "blue", firstDayOfWeek = 1, showFooter = false, singleMode = false
}: DateGridProps) {
  const dim = getDIM(year, month)
  const fdow = getFDOW(year, month, firstDayOfWeek)
  const prevDim = getDIM(year, month === 0 ? 11 : month - 1)
  const effEnd = end ?? hover

  const cells: { date: Date; in: boolean }[] = []
  for (let i = 0; i < fdow; i++) {
    const d = month === 0 ? new Date(year - 1, 11, prevDim - fdow + 1 + i) : new Date(year, month - 1, prevDim - fdow + 1 + i)
    cells.push({ date: d, in: false })
  }
  for (let i = 1; i <= dim; i++) cells.push({ date: new Date(year, month, i), in: true })
  const rem = 42 - cells.length
  for (let i = 1; i <= rem; i++) {
    cells.push({ date: month === 11 ? new Date(year + 1, 0, i) : new Date(year, month + 1, i), in: false })
  }

  const prevY = month === 0 ? year - 1 : year
  const prevM = month === 0 ? 11 : month - 1
  const nextY = month === 11 ? year + 1 : year
  const nextM = month === 11 ? 0 : month + 1

  const days = firstDayOfWeek === 1 ? DAY_NAMES : DAY_NAMES_SU
  const isSolidBlue = theme === "solid-blue"
  const isWhite = theme === "white"

  return (
    <div className="min-w-[230px]">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2",
          isWhite ? "mb-1" : ""
        )}
        style={!isWhite ? { background: isSolidBlue ? "transparent" : "#1e88e5" } : undefined}
      >
        <button onClick={() => onNav(prevY, prevM)} className={cn("p-1 rounded transition-colors", isWhite ? "hover:bg-slate-100" : "hover:bg-white/20")} type="button">
          <ChevronLeft className={cn("w-4 h-4", isWhite ? "text-slate-500" : "text-white")} />
        </button>
        <span className={cn("text-sm font-bold", isWhite ? "text-slate-600" : "text-white")}>
          {isWhite && <span className="text-blue-500 mr-1">{MONTHS_FULL[month]}</span>}
          {!isWhite && <>{MONTHS_FULL[month].slice(0, 3)}</>} {year}
        </span>
        <button onClick={() => onNav(nextY, nextM)} className={cn("p-1 rounded transition-colors", isWhite ? "hover:bg-slate-100" : "hover:bg-white/20")} type="button">
          <ChevronRight className={cn("w-4 h-4", isWhite ? "text-slate-500" : "text-white")} />
        </button>
      </div>

      {/* Days row */}
      <div
        className={cn(
          "grid grid-cols-7",
          isWhite ? "mb-1" : isSolidBlue ? "" : "bg-blue-500/10"
        )}
        style={!isWhite && !isSolidBlue ? { background: "#e3f2fd" } : undefined}
      >
        {days.map((n) => (
          <div
            key={n}
            className={cn(
              "text-center text-xs font-semibold py-2",
              isWhite ? (n === "Su" || n === "Sa" ? "text-slate-400" : "text-slate-500") :
              isSolidBlue ? (n === "Su" ? "text-blue-200" : "text-blue-100") :
              (n === "Su" ? "text-blue-400" : "text-blue-600")
            )}
          >
            {n}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div className={cn("grid grid-cols-7", !isWhite && !isSolidBlue ? "bg-white" : "")}>
        {cells.map((cell, i) => {
          const isS = sameDay(cell.date, start ?? null)
          const isE = !singleMode && sameDay(cell.date, effEnd ?? null)
          const inR = !singleMode && isBetween(cell.date, start ?? null, effEnd ?? null)

          return (
            <div
              key={`idx-${i}`}
              className={cn("h-9 flex items-center justify-center relative", (inR && !isSolidBlue) && "bg-blue-50", (inR && isSolidBlue) && "bg-blue-100/30", cell.in ? "cursor-pointer" : "")}
              onClick={() => { if (cell.in) onSelect(cell.date) }}
              onMouseEnter={() => onHover(cell.date)}
              onMouseLeave={() => onHover(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
            >
              <span
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-full text-sm transition-colors",
                  (isS || isE) ? (isSolidBlue ? "text-white font-bold bg-[#1da1f2]" : "bg-blue-500 text-white font-bold")
                  : !cell.in ? (isSolidBlue ? "text-blue-300/50" : "text-slate-300")
                  : isSolidBlue ? "text-white hover:bg-white/20"
                  : "text-slate-700 hover:bg-blue-100"
                )}
              >
                {cell.date.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {showFooter && (
        <div className={cn("text-center text-xs py-2", isSolidBlue ? "text-blue-100 border-t border-white/10 mt-1" : "text-slate-500 border-t border-slate-100 bg-white")}>
          {start ? fmtShort(start) : "—"}
        </div>
      )}
    </div>
  )
}

// ─── Single Date Picker ────────────────────────────────────────────────────────

export function SingleDatePicker({
  value,
  onChange,
  onClose,
  theme = "blue",
  firstDayOfWeek = 1
}: {
  value: Date | null
  onChange: (d: Date) => void
  onClose: () => void
  theme?: "blue" | "white"
  firstDayOfWeek?: 0 | 1
}) {
  const [y, setY] = useComponentState(value?.getFullYear() ?? new Date().getFullYear())
  const [m, setM] = useComponentState(value?.getMonth() ?? new Date().getMonth())

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className="absolute left-0 top-14 z-30 bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden w-[300px] p-1"
    >
      <DateGrid
        year={y} month={m}
        onNav={(ny, nm) => { setY(ny); setM(nm) }}
        start={value}
        onSelect={(d) => { onChange(d); onClose() }}
        theme={theme}
        firstDayOfWeek={firstDayOfWeek}
        singleMode
      />
    </motion.div>
  )
}

// ─── Date Range Picker ─────────────────────────────────────────────────────────

export function DateRangePicker({
  onApply,
  onCancel,
  theme = "white",
  firstDayOfWeek = 0,
  minWidth = 700
}: {
  onApply: (l: string) => void
  onCancel: () => void
  theme?: "white" | "solid-blue" | "blue"
  firstDayOfWeek?: 0 | 1
  minWidth?: number
}) {
  const [lY, setLY] = useComponentState(2026)
  const [lM, setLM] = useComponentState(1) // Feb
  const [start, setStart] = useComponentState<Date | null>(new Date(2026, 1, 19))
  const [end, setEnd] = useComponentState<Date | null>(new Date(2026, 2, 21))
  const [hover, setHover] = useComponentState<Date | null>(null)
  const [activePreset, setActivePreset] = useComponentState("Last week")

  const rY = lM === 11 ? lY + 1 : lY
  const rM = lM === 11 ? 0 : lM + 1

  function select(d: Date) {
    setActivePreset("")
    if (!start || (start && end)) { setStart(d); setEnd(null) }
    else { if (d < start) { setEnd(start); setStart(d) } else setEnd(d) }
  }

  const PRESETS = [
    { label: "Today", fn: () => { const t = new Date(); setStart(t); setEnd(t) } },
    { label: "Yesterday", fn: () => { const t = new Date(); t.setDate(t.getDate() - 1); setStart(t); setEnd(t) } },
    { label: "Last 7 days", fn: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 6); setStart(s); setEnd(e) } },
    { label: "Last week", fn: () => {
      const n = new Date(), dow = n.getDay() || 7
      const s = new Date(n); s.setDate(n.getDate() - dow - 6)
      const e = new Date(n); e.setDate(n.getDate() - dow)
      setStart(s); setEnd(e)
    }},
    { label: "Last 2 weeks", fn: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 13); setStart(s); setEnd(e) } },
    { label: "This month", fn: () => { const n = new Date(); setStart(new Date(n.getFullYear(), n.getMonth(), 1)); setEnd(new Date(n.getFullYear(), n.getMonth() + 1, 0)) } },
    { label: "Last month", fn: () => { const n = new Date(); setStart(new Date(n.getFullYear(), n.getMonth() - 1, 1)); setEnd(new Date(n.getFullYear(), n.getMonth(), 0)) } },
    { label: "All dates", fn: () => { setStart(null); setEnd(null) } },
  ]

  function apply() {
    if (!start && !end) { onApply("All dates"); return }
    const s = start ? fmtShort(start) : "—"
    const e = end ? fmtShort(end) : s
    onApply(`${s} - ${e}`)
  }

  const isSolidBlue = theme === "solid-blue"

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "absolute left-0 top-12 z-30 rounded-2xl shadow-2xl flex overflow-hidden",
        isSolidBlue ? "border border-white/10" : "bg-white border border-slate-200"
      )}
      style={{
        minWidth,
        background: isSolidBlue ? "linear-gradient(135deg, #1e88e5 0%, #26a69a 100%)" : undefined
      }}
    >
      {/* Presets */}
      <div className={cn("flex flex-col gap-1 p-4 min-w-[140px]", isSolidBlue ? "border-r border-white/10" : "border-r border-slate-100")}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => { p.fn(); setActivePreset(p.label) }}
            className={cn(
              "px-3 py-2 text-sm rounded-lg text-left transition-colors font-medium whitespace-nowrap",
              isSolidBlue
                ? activePreset === p.label ? "bg-white text-blue-600" : "text-white hover:bg-white/20"
                : activePreset === p.label ? "bg-blue-500 text-white" : "text-slate-600 hover:bg-slate-100"
            )} type="button"
          >
            {p.label}
          </button>
        ))}
        <div className="mt-auto pt-3 flex gap-2">
          <button onClick={apply} className="flex-1 py-2 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: "#22b573" }} type="button">Apply</button>
          <button
            onClick={onCancel}
            className={cn(
              "flex-1 py-2 rounded-xl text-sm font-medium transition-colors",
              isSolidBlue ? "text-white hover:bg-white/20" : "text-slate-600 hover:bg-slate-100 border border-slate-200"
            )} type="button"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Dual calendars */}
      <div className="flex gap-4 p-4">
        <DateGrid
          year={lY} month={lM}
          onNav={(y, m) => { setLY(y); setLM(m) }}
          start={start} end={end} hover={hover}
          onSelect={select} onHover={setHover}
          theme={theme} firstDayOfWeek={firstDayOfWeek} showFooter={!isSolidBlue}
        />
        <div className={cn("w-px", isSolidBlue ? "bg-white/10" : "bg-slate-100")} />
        <DateGrid
          year={rY} month={rM}
          onNav={(y, m) => { setLY(m === 0 ? y - 1 : y); setLM(m === 0 ? 11 : m - 1) }}
          start={start} end={end} hover={hover}
          onSelect={select} onHover={setHover}
          theme={theme} firstDayOfWeek={firstDayOfWeek} showFooter={!isSolidBlue}
        />
      </div>
    </motion.div>
  )
}
