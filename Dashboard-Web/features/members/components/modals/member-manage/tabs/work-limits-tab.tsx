"use client"

import { type ReactNode } from "react"
import { CalendarClock } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import {
  SHIFT_ALLOWANCE_COMING_SOON_MESSAGE,
  SHIFT_ALLOWANCE_LIMITS_ENABLED,
  isActiveHourLimit,
  validateWorkLimitsCombo,
} from "@/shared/validation/work-limits"
import { Toggle } from "@/shared/ui/toggle";
import type { TabProps } from "@/features/members/components/modals/member-manage/types"

function roundToQuarterHour(hours: number): number {
  return Math.round(hours / 0.25) * 0.25
}

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
        "rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm transition-opacity",
        dimmed && "pointer-events-none opacity-50",
      )}
    >
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
      {description ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}
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
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
            "peer min-w-0 flex-1 rounded-l-lg border border-r-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-2.5 text-sm transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-400 dark:focus:border-emerald-500 focus:outline-none",
            disabled && "cursor-not-allowed bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500",
          )}
        />
        <span
          className={cn(
            "whitespace-nowrap rounded-r-lg border border-l-0 border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400 transition-colors peer-focus:border-blue-400 dark:peer-focus:border-emerald-500",
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
  const selectedDays = state.workDays
  const comboError = validateWorkLimitsCombo(
    state.weeklyLimit,
    state.dailyLimit,
    selectedDays.length,
    state.useShiftsForLimits,
  )
  const shiftsComingSoon = !SHIFT_ALLOWANCE_LIMITS_ENABLED

  const selectedDayLabels = WEEKDAYS.filter((d) => selectedDays.includes(d.index)).map((d) => d.label)

  const handleDailyChange = (dailyLimit: string) => {
    setState((s) => {
      const next = { ...s, dailyLimit }
      if (selectedDays.length > 0 && isActiveHourLimit(dailyLimit)) {
        next.weeklyLimit = String(roundToQuarterHour(Number(dailyLimit) * selectedDays.length))
      }
      return next
    })
  }

  const handleWeeklyChange = (weeklyLimit: string) => {
    setState((s) => {
      const next = { ...s, weeklyLimit }
      if (selectedDays.length > 0 && isActiveHourLimit(weeklyLimit)) {
        next.dailyLimit = String(roundToQuarterHour(Number(weeklyLimit) / selectedDays.length))
      }
      return next
    })
  }

  const toggleDay = (index: number) =>
    setState((s) => ({
      ...s,
      workDays: selectedDays.includes(index)
        ? selectedDays.filter((d: number) => d !== index)
        : [...selectedDays, index],
    }))

  const makeupDays = state.makeupDays
  const toggleMakeupDay = (index: number) =>
    setState((s) => ({
      ...s,
      makeupDays: makeupDays.includes(index)
        ? makeupDays.filter((d: number) => d !== index)
        : [...makeupDays, index],
    }))

  const makeupDayLabels = WEEKDAYS.filter((d) => makeupDays.includes(d.index)).map((d) => d.label)

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
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Use shifts to set work allowance limits
              </span>
              {shiftsComingSoon ? (
                <span className="inline-flex rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Coming soon
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              When enabled, weekly and daily caps follow this member&apos;s shift schedule.
            </p>
          </div>
          <Toggle checked={false} disabled={shiftsComingSoon} onChange={() => {}} />
        </div>

        {shiftsComingSoon ? (
          <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
            <div className="flex gap-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
              <p className="text-sm text-slate-600 dark:text-slate-400">{SHIFT_ALLOWANCE_COMING_SOON_MESSAGE}</p>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Working days"
        description="Select the days this member is expected to work. Double-click a day to flag it red as a recurring makeup day."
      >
        <div>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const selected = selectedDays.includes(day.index)
              const isMakeup = makeupDays.includes(day.index)
              return (
                <IconTooltip
                  key={day.label}
                  text={isMakeup ? `${day.label} (makeup day)` : day.label}
                  placement="top"
                >
                  <button
                    type="button"
                    onClick={() => toggleDay(day.index)}
                    onDoubleClick={() => toggleMakeupDay(day.index)}
                    aria-label={day.label}
                    aria-pressed={isMakeup}
                    className={cn(
                      "flex h-11 min-w-11 flex-col items-center justify-center rounded-xl border-2 px-2 text-[10px] font-bold transition-colors sm:h-12 sm:min-w-12",
                      isMakeup
                        ? "border-red-500 bg-red-500 dark:border-red-600 dark:bg-red-600 text-white"
                        : selected
                          ? "border-blue-500 bg-blue-500 dark:border-emerald-500 dark:bg-emerald-500 text-white"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-blue-300 dark:hover:border-emerald-700 hover:text-blue-500 dark:hover:text-emerald-400",
                    )}
                  >
                    {day.short}
                  </button>
                </IconTooltip>
              )
            })}
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            {selectedDayLabels.length > 0 ? (
              <>
                <span className="font-semibold text-slate-800 dark:text-slate-200">Selected: </span>
                {selectedDayLabels.join(", ")}
              </>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">No working days selected</span>
            )}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {makeupDayLabels.length > 0 ? (
              <>
                <span className="font-semibold text-red-600 dark:text-red-400">Makeup: </span>
                {makeupDayLabels.join(", ")}
              </>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">No makeup days set</span>
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
            onChange={handleWeeklyChange}
          />
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
            onChange={handleDailyChange}
          />
        </SectionCard>
      </div>

      {comboError ? (
        <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-800 dark:text-red-300" role="alert">
          {comboError}
        </div>
      ) : null}
    </div>
  )
}
