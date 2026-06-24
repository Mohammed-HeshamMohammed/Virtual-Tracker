/* eslint-disable react-doctor/use-lazy-motion */
"use client"

import { useRef, useState } from "react"
import { X, Check, Search, Info, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { AnimatePresence, motion } from "framer-motion"

import { MEMBERS as SHARED_MEMBERS } from "@/features/settings/components/shared/constants"

export const MEMBERS = SHARED_MEMBERS


export const PAGE_SIZE = 4

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const show = () => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.top - 8, left: r.left + r.width / 2 })
  }
  return (
    <div ref={ref} className="relative inline-flex items-center" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && (
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translate(-50%,-100%)", zIndex: 9999, pointerEvents: "none" }}
          className="w-56 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg text-center"
        >
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  )
}

export function SectionLabel({ label, info, isDark, className }: { label: string; info?: string; isDark: boolean; className?: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={cn("text-base font-bold tracking-widest uppercase", isDark ? "text-white/40" : "text-slate-500", className)}>{label}</span>
      {info && <Tooltip text={info}><Info className={cn("w-3.5 h-3.5 cursor-help", isDark ? "text-white/30" : "text-slate-400")} /></Tooltip>}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0", checked ? "bg-[#6b38d4]" : "bg-slate-200")} type="button">
      <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center", checked ? "translate-x-5" : "translate-x-0")}>
        {checked && <svg className="w-3 h-3 text-[#6b38d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
    </button>
  )
}

export function MemberAvatar({ m }: { m: typeof MEMBERS[0] }) {
  return (
    <div className={cn("w-8 h-8 text-xs rounded-full flex items-center justify-center text-white font-bold shrink-0", m.color)}>
      {m.initials}
    </div>
  )
}

function NumberInput({ value, onChange, isDark }: { value: string; onChange: (v: string) => void; isDark: boolean }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (v === "" || v === "0" || (Number(v) >= 0 && !isNaN(Number(v)))) onChange(v)
  }
  return (
    <input
      type="number"
      value={value}
      onChange={handleChange}
      min="0"
      className={cn("w-20 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors",
        isDark ? "bg-[#1a2235] border-white/10 text-white placeholder:text-white/20" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-300"
      )}
      style={{ MozAppearance: "textfield", WebkitAppearance: "none", appearance: "none" }} aria-label="Interactive control"
    />
  )
}

function UnitBadge({ label, isDark }: { label: string; isDark: boolean }) {
  return (
    <span className={cn("px-3 py-1.5 text-sm font-medium border rounded-lg", isDark ? "bg-white/5 border-white/10 text-white/50" : "bg-slate-50 border-slate-200 text-slate-500")}>
      {label}
    </span>
  )
}

export function SearchInput({ placeholder, value, onChange, isDark }: { placeholder: string; value: string; onChange: (v: string) => void; isDark: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 px-3 py-2 border rounded-full text-sm", isDark ? "bg-[#1a2235] border-white/10 text-white" : "bg-white border-slate-200 text-slate-600")}>
      <Search className="w-3.5 h-3.5 shrink-0 opacity-40" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="bg-transparent outline-none placeholder:opacity-40 w-36 text-sm" />
    </div>
  )
}

export function Paginator({ page, total, onPage, isDark }: { page: number; total: number; onPage: (p: number) => void; isDark: boolean }) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (pages <= 1) return (
    <div className={cn("px-4 py-2.5 text-xs border-t", isDark ? "border-white/5 text-white/30" : "border-slate-100 text-slate-400")}>
      Showing {total} of {total} members
    </div>
  )
  const start = page * PAGE_SIZE + 1
  const end   = Math.min((page + 1) * PAGE_SIZE, total)
  return (
    <div className={cn("flex items-center justify-between px-4 py-2.5 border-t text-xs", isDark ? "border-white/5 text-white/30" : "border-slate-100 text-slate-400")}>
      <span>Showing {start}–{end} of {total} members</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page === 0}
          className={cn("p-1 rounded transition-colors disabled:opacity-30", isDark ? "hover:bg-white/10" : "hover:bg-slate-100")} type="button">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {Array.from({ length: pages }, (_, i) => (
          <button key={i} onClick={() => onPage(i)}
            className={cn("w-6 h-6 rounded text-xs font-medium transition-colors",
              i === page ? "bg-blue-500 text-white" : isDark ? "hover:bg-white/10 text-white/50" : "hover:bg-slate-100 text-slate-500"
            )} type="button">
            {i + 1}
          </button>
        ))}
        <button onClick={() => onPage(page + 1)} disabled={page === pages - 1}
          className={cn("p-1 rounded transition-colors disabled:opacity-30", isDark ? "hover:bg-white/10" : "hover:bg-slate-100")} type="button">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function SubNavLayout({ items, active, onChange, isDark, children }: {
  items: { k: string; l: string }[]
  active: string
  onChange: (k: string) => void
  isDark: boolean
  children: React.ReactNode
}) {
  return (
    // h-full so the layout fills whatever parent gives it (Achievements wraps it in h-full)
    <div className="flex flex-col md:flex-row w-full h-full gap-0 overflow-hidden">
      {/* Subnav — self-start so it never stretches to fill height and never scrolls */}
      <div className={cn("w-full md:w-48 md:border-r py-2 md:pr-4 space-y-0.5 shrink-0 self-start", isDark ? "border-white/5" : "border-slate-100")}>
        {items.map(i => (
          <button key={i.k} onClick={() => onChange(i.k)}
            className={cn("w-full text-left text-sm py-2 px-3 transition-colors",
              active === i.k
                ? "text-blue-500 font-semibold border-l-2 border-blue-500"
                : isDark ? "text-white/40 hover:text-white/70" : "text-slate-500 hover:text-slate-700"
            )} type="button">
            {i.l}
          </button>
        ))}
      </div>

      {/* Content panel — fills remaining height, children handle their own scroll */}
      <div className="flex-1 md:pl-8 py-2 h-full overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className="h-full"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
