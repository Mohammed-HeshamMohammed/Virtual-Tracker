"use client"

import { useState as useComponentState } from "react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { MEMBERS, PAGE_SIZE, SectionLabel, Toggle, MemberAvatar, NumberInput, UnitBadge, Paginator } from "@/features/settings/components/members/components/primitives"
import { Toggle as PeopleMembersToggle } from "@/shared/ui/toggle"
import { DAYS, DEFAULT_ACTIVE_DAYS, DEFAULT_EXPECTED_HRS } from "@/features/settings/components/shared/constants"

export default function WorkTimeLimits() {
  const { isDark } = useTheme()
  const [activeDays, setActiveDays] = useComponentState(DEFAULT_ACTIVE_DAYS)
  const [disableSpecific, setDisableSpecific] = useComponentState(false)
  const [expectedHrs, setExpectedHrs] = useComponentState(DEFAULT_EXPECTED_HRS)
  const [weeklyLimit, setWeeklyLimit] = useComponentState("")
  const [dailyLimit, setDailyLimit] = useComponentState("")
  const [page, setPage] = useComponentState(0)
  const [memberSettings, setMemberSettings] = useComponentState(
    MEMBERS.map(m => ({ id: m.id, expectedHrs: m.id === 1 || m.id === 4 ? "40" : "", weeklyLimit: "", dailyLimit: "" }))
  )

  const toggleDay = (d: string) => {
    if (disableSpecific) return
    setActiveDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])
  }

  const expectedDaysLabel = () => {
    const wkdays = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    if (activeDays.length === 5 && wkdays.every(d => activeDays.includes(d))) return "Mon - Fri"
    return activeDays.join(", ") || "None"
  }

  const handleCancel = () => {
    setActiveDays(DEFAULT_ACTIVE_DAYS)
    setDisableSpecific(false)
    setExpectedHrs(DEFAULT_EXPECTED_HRS)
    setWeeklyLimit("")
    setDailyLimit("")
  }

  const pageSlice = memberSettings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-3">
          <SectionLabel label="Weekly Work Days" isDark={isDark} />
          <p className={cn("text-sm", isDark ? "text-white/40" : "text-slate-500")}>
            Set the week days members are expected to work. You can also set which days members are not allowed to track time.
          </p>
          <p className={cn("text-sm", isDark ? "text-white/60" : "text-slate-600")}>
            Expected work days: <strong>{expectedDaysLabel()}</strong>
          </p>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map(d => (
              <button key={d} onClick={() => toggleDay(d)}
                disabled={disableSpecific}
                className={cn("w-12 h-12 rounded-full text-sm font-semibold transition-colors",
                  disableSpecific
                    ? "opacity-40 cursor-not-allowed " + (activeDays.includes(d) ? "bg-blue-500 text-white" : isDark ? "bg-white/5 text-white/50" : "bg-slate-100 text-slate-500")
                    : activeDays.includes(d)
                      ? "bg-blue-500 text-white"
                      : isDark ? "bg-white/5 text-white/50 hover:bg-white/10" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                )} type="button">
                {d}
              </button>
            ))}
          </div>
          <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 mt-3",
            isDark ? "border-white/10 bg-white/5" : "border-slate-100 bg-slate-50/60")}>
            <div className="min-w-0">
              <span className={cn("text-sm font-semibold", isDark ? "text-white" : "text-slate-800")}>Disable time tracking on specific days</span>
              <p className={cn("mt-0.5 text-xs", isDark ? "text-white/50" : "text-slate-500")}>When on, choose days below where tracking is blocked.</p>
            </div>
            <PeopleMembersToggle checked={disableSpecific} onChange={() => setDisableSpecific(p => !p)} />
          </div>
        </div>

        <div className="space-y-5">
          <div className="flex items-center gap-2 justify-end">
            <button onClick={handleCancel} className={cn("px-4 py-1.5 text-sm font-medium transition-colors", isDark ? "text-white/50 hover:text-white/80" : "text-slate-500 hover:text-slate-700")} type="button">Cancel</button>
            <button className="px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors" type="button">Save</button>
          </div>

          <div>
            <SectionLabel label="Expected Weekly Work Hours" isDark={isDark} />
            <p className={cn("text-sm mb-2", isDark ? "text-white/40" : "text-slate-500")}>Set the hours members are expected to work weekly</p>
            <div className="flex items-center gap-2">
              <NumberInput value={expectedHrs} onChange={setExpectedHrs} isDark={isDark} />
              <UnitBadge label="hrs/wk" isDark={isDark} />
            </div>
          </div>
          <div>
            <SectionLabel label="Weekly Limit" isDark={isDark} />
            <p className={cn("text-sm mb-2", isDark ? "text-white/40" : "text-slate-500")}>Set the hours members are allowed to work weekly</p>
            <div className={cn("flex min-w-0 rounded-lg border focus-within:ring-1 focus-within:ring-blue-400/20 focus-within:border-blue-400 overflow-hidden",
              isDark ? "border-white/10 bg-[#1a2235]" : "border-slate-200 bg-white")}>
              <input
                type="number"
                min="0"
                value={weeklyLimit}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === "" || v === "0" || (Number(v) >= 0 && !isNaN(Number(v)))) setWeeklyLimit(v)
                }}
                placeholder=""
                className={cn("min-w-0 flex-1 border-0 bg-transparent px-3 py-1.5 text-sm rounded-l-lg focus:outline-none focus:ring-0",
                  isDark ? "text-white placeholder:text-white/20" : "text-slate-700 placeholder:text-slate-300",
                  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                )} aria-label="Interactive control"
              />
              <span className={cn("flex shrink-0 select-none items-center border-l px-3 text-sm font-medium rounded-r-lg",
                isDark ? "border-white/10 bg-white/5 text-white/50" : "border-slate-200 bg-slate-50 text-slate-500")}>
                hrs/wk
              </span>
            </div>
          </div>
          <div>
            <SectionLabel label="Daily Limit" isDark={isDark} />
            <p className={cn("text-sm mb-2", isDark ? "text-white/40" : "text-slate-500")}>Set the hours members are allowed to work daily</p>
            <div className={cn("flex min-w-0 rounded-lg border focus-within:ring-1 focus-within:ring-blue-400/20 focus-within:border-blue-400 overflow-hidden",
              isDark ? "border-white/10 bg-[#1a2235]" : "border-slate-200 bg-white")} aria-label="Interactive control">
              <input
                type="number"
                min="0"
                value={dailyLimit}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === "" || v === "0" || (Number(v) >= 0 && !isNaN(Number(v)))) setDailyLimit(v)
                }}
                placeholder=""
                className={cn("min-w-0 flex-1 border-0 bg-transparent px-3 py-1.5 text-sm rounded-l-lg focus:outline-none focus:ring-0",
                  isDark ? "text-white placeholder:text-white/20" : "text-slate-700 placeholder:text-slate-300",
                  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                )}
              />
              <span className={cn("flex shrink-0 select-none items-center border-l px-3 text-sm font-medium rounded-r-lg",
                isDark ? "border-white/10 bg-white/5 text-white/50" : "border-slate-200 bg-slate-50 text-slate-500")}>
                hrs/day
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={cn("border-t pt-6", isDark ? "border-white/5" : "border-slate-100")}>
        <h3 className={cn("text-base font-bold mb-1", isDark ? "text-white" : "text-slate-800")}>Individual settings</h3>
        <p className={cn("text-sm mb-4", isDark ? "text-white/40" : "text-slate-500")}>Override the organization default for specific members</p>
        <div className={cn("border rounded-xl overflow-hidden", isDark ? "border-white/5" : "border-slate-100")}>
          <div className={cn("grid items-center px-4 py-3 text-sm font-semibold gap-4", isDark ? "bg-white/5 text-white/50" : "bg-slate-50 text-slate-600")}
            style={{ gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr" }}>
            <span>Name</span>
            <span>Weekly work days</span>
            <span>Expected work hours</span>
            <span>Weekly limit</span>
            <span>Daily limit</span>
          </div>
          {pageSlice.map((ms, i) => {
            const m = MEMBERS.find(x => x.id === ms.id)!
            const globalIdx = memberSettings.findIndex(x => x.id === ms.id)
            const setMs = (field: string, val: string) =>
              setMemberSettings(prev => prev.map((p, j) => j !== globalIdx ? p : { ...p, [field]: val }))
            return (
              <div key={ms.id} className={cn("grid items-center px-4 py-4 gap-4", i < pageSlice.length - 1 && (isDark ? "border-b border-white/5" : "border-b border-slate-100"))}
                style={{ gridTemplateColumns: "1fr 2fr 1fr 1fr 1fr" }}>
                <div className="flex items-center gap-2">
                  <MemberAvatar m={m} />
                  <span className={cn("text-sm font-medium", isDark ? "text-white/80" : "text-slate-700")}>{m.name}</span>
                </div>
                <div className={cn("text-sm", isDark ? "text-white/50" : "text-slate-500")}>
                  <div>Expected work days: <strong className={isDark ? "text-white/70" : "text-slate-700"}>Mon - Fri</strong></div>
                  <div>Not allowed to track on: <strong className={isDark ? "text-white/70" : "text-slate-700"}>-</strong></div>
                </div>
                <div className="flex items-center gap-1">
                  <NumberInput value={ms.expectedHrs} onChange={v => setMs("expectedHrs", v)} isDark={isDark} />
                  <UnitBadge label="wk" isDark={isDark} />
                </div>
                <div className="flex items-center gap-1">
                  <NumberInput value={ms.weeklyLimit} onChange={v => setMs("weeklyLimit", v)} isDark={isDark} />
                  <UnitBadge label="wk" isDark={isDark} />
                </div>
                <div className="flex items-center gap-1">
                  <NumberInput value={ms.dailyLimit} onChange={v => setMs("dailyLimit", v)} isDark={isDark} />
                  <UnitBadge label="day" isDark={isDark} />
                </div>
              </div>
            )
          })}
          <Paginator page={page} total={memberSettings.length} onPage={setPage} isDark={isDark} />
        </div>
      </div>
    </div>
  )
}
