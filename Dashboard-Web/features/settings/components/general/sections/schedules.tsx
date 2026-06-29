/* eslint-disable react-doctor/rerender-lazy-state-init */
"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import {
  MEMBERS,
  PAGE_SIZE,
  SectionLabel,
  MemberAvatar,
  SearchInput,
  Paginator,
  SubNavLayout,
} from "@/features/settings/components/general/components/primitives"
import { SCHEDULE_SUBNAV, ALERT_OPTIONS, GRACE_OPTIONS, type ScheduleKey, type AlertOption, type GraceOption } from "@/features/settings/components/shared/constants"

// ── Shared segment control ────────────────────────────────────────────────────
function SegmentControl<T extends string>({
  options, value, onChange, isDark,
}: { options: readonly T[]; value: T; onChange: (v: T) => void; isDark: boolean }) {
  return (
    <div className={cn("inline-flex rounded-full border p-0.5", isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50")}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)}
          className={cn("px-5 py-1.5 text-sm font-medium rounded-full transition-colors",
            value === opt
              ? isDark ? "bg-white/10 text-white" : "bg-white text-slate-800 shadow-sm"
              : isDark ? "text-white/40 hover:text-white/60" : "text-slate-500 hover:text-slate-700"
          )} type="button">
          {opt}
        </button>
      ))}
    </div>
  )
}

// ── Custom dropdown ───────────────────────────────────────────────────────────
function GraceDropdown({ value, onChange, isDark }: { value: GraceOption; onChange: (v: GraceOption) => void; isDark: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        className={cn("flex items-center gap-2 px-4 py-2 text-sm border rounded-lg min-w-[110px] justify-between transition-colors",
          open
            ? "border-blue-400 ring-2 ring-blue-500/20"
            : isDark ? "border-white/10 bg-[#1a2235] text-white" : "border-slate-200 bg-white text-slate-700",
          isDark ? "bg-[#1a2235] text-white" : "bg-white text-slate-700"
        )} type="button"
      >
        <span>{value}</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180", isDark ? "text-white/40" : "text-slate-400")} />
      </button>
      {open && (
        <div className={cn("absolute top-full left-0 mt-1 w-full rounded-lg border shadow-lg z-50 overflow-hidden",
          isDark ? "bg-[#1a2235] border-white/10" : "bg-white border-slate-200"
        )}>
          {GRACE_OPTIONS.map(opt => (
            <button key={opt} onClick={() => { onChange(opt); setOpen(false) }}
              className={cn("w-full text-left px-4 py-2 text-sm transition-colors",
                opt === value
                  ? "bg-blue-500 text-white"
                  : isDark ? "text-white/70 hover:bg-white/5" : "text-slate-700 hover:bg-slate-50"
              )} type="button">
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Calendar type panel ───────────────────────────────────────────────────────
function CalendarTypePanel({ isDark }: { isDark: boolean }) {
  const [value, setValue] = useState<"Private" | "Collaborative">("Private")
  return (
    <div className="space-y-4">
      <SectionLabel
        label="Calendar Type"
        info="This setting determines what users can view in the calendar. Organization owners and managers will always have full visibility."
        isDark={isDark}
      />
      <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>
        Making the calendar private restricts users so they can only view their own shifts and time off. If the calendar is collaborative, everyone is able to view all shifts and time off for all members of the organization.
      </p>
      <div>
        <SectionLabel label="All Users" info="This setting affects all users." isDark={isDark} />
        <SegmentControl options={["Private", "Collaborative"] as const} value={value} onChange={setValue} isDark={isDark} />
      </div>
    </div>
  )
}

// ── Shift alerts panel ────────────────────────────────────────────────────────
function ShiftAlertsPanel({ isDark }: { isDark: boolean }) {
  const [global, setGlobal] = useState<AlertOption>("Both")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [memberAlerts, setMemberAlerts] = useState<{ id: number; value: AlertOption }[]>(
    MEMBERS.map(m => ({ id: m.id, value: "Both" }))
  )

  const filtered = MEMBERS.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <SectionLabel
          label="Shift Alerts"
          info="This applies to the schedules, which sends alerts when someone is late, misses, or abandons a shift."
          isDark={isDark}
        />
        <p className={cn("text-sm mb-3", isDark ? "text-white/40" : "text-slate-500")}>Control who receives alerts about a member</p>
        <SectionLabel label="Global" info="Organization default. This is what all current and future members will be set to." isDark={isDark} />
        <SegmentControl options={ALERT_OPTIONS} value={global} onChange={setGlobal} isDark={isDark} />
      </div>

      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className={cn("text-base font-bold", isDark ? "text-white" : "text-slate-800")}>Individual settings</h3>
            <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>Override the organization default for specific members</p>
          </div>
          <SearchInput placeholder="Search members" value={search} onChange={v => { setSearch(v); setPage(0) }} isDark={isDark} />
        </div>
        <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
          <div className={cn("px-4 py-3 text-sm font-semibold", isDark ? "bg-white/5 text-white/50" : "bg-slate-50 text-slate-600")}>
            Name
          </div>
          {pageSlice.map((m, i) => {
            const ms = memberAlerts.find(x => x.id === m.id)!
            const idx = memberAlerts.findIndex(x => x.id === m.id)
            return (
              <div key={m.id} className={cn("flex items-center justify-between px-4 py-3", i < pageSlice.length - 1 && (isDark ? "border-b border-white/5" : "border-b border-slate-100"))}>
                <div className="flex items-center gap-2">
                  <MemberAvatar m={m} />
                  <span className={cn("text-sm font-medium", isDark ? "text-white/80" : "text-slate-700")}>{m.name}</span>
                </div>
                <SegmentControl
                  options={ALERT_OPTIONS}
                  value={ms.value}
                  onChange={v => setMemberAlerts(p => p.map((x, j) => j !== idx ? x : { ...x, value: v }))}
                  isDark={isDark}
                />
              </div>
            )
          })}
          <Paginator page={page} total={filtered.length} onPage={setPage} isDark={isDark} />
        </div>
      </div>
    </div>
  )
}

// ── Grace period panel ────────────────────────────────────────────────────────
function GracePeriodPanel({ isDark }: { isDark: boolean }) {
  const [global, setGlobal] = useState<GraceOption>("5 min")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [memberGrace, setMemberGrace] = useState<{ id: number; value: GraceOption }[]>(
    MEMBERS.map(m => ({ id: m.id, value: "5 min" }))
  )

  const applyToAll = () => setMemberGrace(p => p.map(m => ({ ...m, value: global })))
  const filtered = MEMBERS.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <SectionLabel
          label="Grace Period"
          info="This setting controls the amount of time that can pass before a shift is considered late."
          isDark={isDark}
        />
        <p className={cn("text-sm mb-3", isDark ? "text-white/40" : "text-slate-500")}>Set a grace period for determining if a shift is considered late.</p>
        <SectionLabel label="Global" info="Organization default. This is what all current and future members will be set to." isDark={isDark} />
        <div className="flex items-center gap-3">
          <GraceDropdown value={global} onChange={setGlobal} isDark={isDark} />
          <button onClick={applyToAll} className="px-4 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors" type="button">
            Apply to all
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className={cn("text-base font-bold", isDark ? "text-white" : "text-slate-800")}>Individual settings</h3>
            <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>Override the organization default for specific members</p>
          </div>
          <SearchInput placeholder="Search members" value={search} onChange={v => { setSearch(v); setPage(0) }} isDark={isDark} />
        </div>
        <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
          <div className={cn("px-4 py-3 text-sm font-semibold", isDark ? "bg-white/5 text-white/50" : "bg-slate-50 text-slate-600")}>
            Name
          </div>
          {pageSlice.map((m, i) => {
            const ms = memberGrace.find(x => x.id === m.id)!
            const idx = memberGrace.findIndex(x => x.id === m.id)
            return (
              <div key={m.id} className={cn("flex items-center justify-between px-4 py-3", i < pageSlice.length - 1 && (isDark ? "border-b border-white/5" : "border-b border-slate-100"))}>
                <div className="flex items-center gap-2">
                  <MemberAvatar m={m} />
                  <span className={cn("text-sm font-medium", isDark ? "text-white/80" : "text-slate-700")}>{m.name}</span>
                </div>
                <GraceDropdown
                  value={ms.value}
                  onChange={v => setMemberGrace(p => p.map((x, j) => j !== idx ? x : { ...x, value: v }))}
                  isDark={isDark}
                />
              </div>
            )
          })}
          <Paginator page={page} total={filtered.length} onPage={setPage} isDark={isDark} />
        </div>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function SchedulesSettings({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { isDark } = useTheme()
  const [sub, setSub] = useState<ScheduleKey>("calendartype")

  return (
    <SubNavLayout items={SCHEDULE_SUBNAV} active={sub} onChange={k => setSub(k as ScheduleKey)} isDark={isDark}>
      {sub === "calendartype" && <CalendarTypePanel isDark={isDark} />}
      {sub === "shiftalerts" && <ShiftAlertsPanel isDark={isDark} />}
      {sub === "graceperiod" && <GracePeriodPanel isDark={isDark} />}
    </SubNavLayout>
  )
}
