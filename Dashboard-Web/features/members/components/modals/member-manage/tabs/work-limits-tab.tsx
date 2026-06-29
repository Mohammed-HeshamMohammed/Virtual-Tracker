"use client"

import type { ReactNode } from "react"
import { CalendarClock } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import {
  isActiveHourLimit,
  SHIFT_ALLOWANCE_COMING_SOON_MESSAGE,
  SHIFT_ALLOWANCE_LIMITS_ENABLED,
  WORK_LIMITS_EXCLUSION_HINT,
} from "@/shared/validation/work-limits"
import { Toggle } from "@/shared/ui/toggle";
import type { TabProps } from "@/features/members/components/modals/member-manage/types"

const WEEKDAYS: { label: string; short: string; index: number }[] = [
  { label: "Monday", short: "Mo", index: 0 },
  { label: "Tuesday", short: "Tu", index: 1 },
  { label: "Wednesday", short: "We", index: 2 },
  { label: "Thursday", short: "Th", index: 3 },
  { label: "Friday", short: "Fr", index: 4 },
  { label: "Saturday", short: "Sa", index: 5 },
  { label: "Sunday", short: "Su", index: 6 },
]

function SectionCard({
  title,
  description,
  children,
  dimmed,
}: {
  title: string
  description?: string
  children: ReactNode
  dimmed?: boolean
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-opacity",
        dimmed && "pointer-events-none opacity-50",
      )}
    >
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function LimitInput({
  id,
  label,
  suffix,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  suffix: string
  placeholder: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="flex">
        <input
          id={id}
          type="number"
          min={0}
          step={0.25}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === "") {
              onChange("")
              return
            }
            const n = Math.max(0, Number(raw))
            onChange(Number.isFinite(n) ? String(n) : "")
          }}
          placeholder={placeholder}
          className={cn(
            "peer min-w-0 flex-1 rounded-l-lg border border-r-0 border-slate-200 px-3 py-2.5 text-sm transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:outline-none",
            disabled && "cursor-not-allowed bg-slate-50 text-slate-400",
          )}
        />
        <span
          className={cn(
            "whitespace-nowrap rounded-r-lg border border-l-0 border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-500 transition-colors peer-focus:border-blue-400",
            disabled && "opacity-60",
          )}
        >
          {suffix}
        </span>
      </div>
    </div>
  )
}

export function WorkLimitsTab({ state, setState }: TabProps) {
  const disableTracking = state.disableTrackingSpecificDays
  const selectedDays = state.workDays
  const weeklyActive = isActiveHourLimit(state.weeklyLimit)
  const dailyActive = isActiveHourLimit(state.dailyLimit)
  const bothActive = weeklyActive && dailyActive
  const shiftsComingSoon = !SHIFT_ALLOWANCE_LIMITS_ENABLED

  const selectedDayLabels = WEEKDAYS.filter((d) => selectedDays.includes(d.index)).map((d) => d.label)

  const toggleDay = (index: number) =>
    setState((s) => ({
      ...s,
      workDays: selectedDays.includes(index)
        ? selectedDays.filter((d: number) => d !== index)
        : [...selectedDays, index],
    }))

  return (
    <div className="space-y-5">
      <SectionCard
        title="Allowance source"
        description="Choose whether limits come from scheduled shifts or manual hour caps."
      >
        <div
          className={cn(
            "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
            shiftsComingSoon && "opacity-70",
          )}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">
                Use shifts to set work allowance limits
              </span>
              {shiftsComingSoon ? (
                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  Coming soon
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              When enabled, weekly and daily caps follow this member&apos;s shift schedule.
            </p>
          </div>
          <Toggle checked={false} disabled={shiftsComingSoon} onChange={() => {}} />
        </div>

        {shiftsComingSoon ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex gap-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <p className="text-sm text-slate-600">{SHIFT_ALLOWANCE_COMING_SOON_MESSAGE}</p>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Working days"
        description="Select the days this member is expected to work."
      >
        <div className={cn(disableTracking && "pointer-events-none opacity-40")}>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const selected = selectedDays.includes(day.index)
              return (
                <IconTooltip key={day.label} text={day.label} placement="top">
                  <button
                    type="button"
                    onClick={() => toggleDay(day.index)}
                    aria-label={day.label}
                    className={cn(
                      "flex h-11 min-w-11 flex-col items-center justify-center rounded-xl border-2 px-2 text-[10px] font-bold transition-colors sm:h-12 sm:min-w-12",
                      selected
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-500",
                    )}
                  >
                    {day.short}
                  </button>
                </IconTooltip>
              )
            })}
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {selectedDayLabels.length > 0 ? (
              <>
                <span className="font-semibold text-slate-800">Selected: </span>
                {selectedDayLabels.join(", ")}
              </>
            ) : (
              <span className="text-slate-400">No working days selected</span>
            )}
          </p>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Weekly limit"
          description="Maximum hours allowed per week. Leave empty for no limit."
        >
          <LimitInput
            id="weekly-limit"
            label="Hours per week"
            suffix="hrs/wk"
            placeholder="No limit"
            value={state.weeklyLimit}
            disabled={dailyActive && !weeklyActive}
            onChange={(weeklyLimit) => setState((s) => ({ ...s, weeklyLimit }))}
          />
          {dailyActive && !weeklyActive ? (
            <p className="mt-2 text-xs text-slate-500">{WORK_LIMITS_EXCLUSION_HINT}</p>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Daily limit"
          description="Maximum hours allowed per day. Leave empty for no limit."
        >
          <LimitInput
            id="daily-limit"
            label="Hours per day"
            suffix="hrs/day"
            placeholder="No limit"
            value={state.dailyLimit}
            disabled={weeklyActive && !dailyActive}
            onChange={(dailyLimit) => setState((s) => ({ ...s, dailyLimit }))}
          />
          {weeklyActive && !dailyActive ? (
            <p className="mt-2 text-xs text-slate-500">{WORK_LIMITS_EXCLUSION_HINT}</p>
          ) : null}
        </SectionCard>
      </div>

      {bothActive ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {WORK_LIMITS_EXCLUSION_HINT}
        </div>
      ) : null}

      <SectionCard title="Tracking restrictions">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-slate-800">Disable time tracking on specific days</span>
            <p className="mt-0.5 text-xs text-slate-500">When enabled, tracking can be blocked on selected days.</p>
          </div>
          <Toggle
            checked={disableTracking}
            onChange={() =>
              setState((s) => ({ ...s, disableTrackingSpecificDays: !s.disableTrackingSpecificDays }))
            }
          />
        </div>
      </SectionCard>
    </div>
  )
}
