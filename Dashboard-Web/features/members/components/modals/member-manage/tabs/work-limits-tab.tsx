"use client"

import { useMemo, useState, type ComponentProps, type ReactNode } from "react"
import { CalendarClock } from "lucide-react"
import { DayButton } from "react-day-picker"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import {
  isActiveHourLimit,
  SHIFT_ALLOWANCE_COMING_SOON_MESSAGE,
  SHIFT_ALLOWANCE_LIMITS_ENABLED,
  WORK_LIMITS_EXCLUSION_HINT,
} from "@/shared/validation/work-limits"
import { Toggle } from "@/shared/ui/toggle";
import { Calendar, CalendarDayButton } from "@/shared/ui/calendar"
import type { TabProps } from "@/features/members/components/modals/member-manage/types"

/** Local calendar date key (not UTC - toISOString() would shift dates near
 * midnight in negative-offset timezones). */
function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatDisplayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
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

  const makeupDays = state.makeupDays
  const [pendingMissedKey, setPendingMissedKey] = useState<string | null>(null)
  const missedDateKeys = useMemo(() => new Set(makeupDays.map((p) => p.missedDate)), [makeupDays])
  const makeupDateKeys = useMemo(() => new Set(makeupDays.map((p) => p.makeupDate)), [makeupDays])

  const handleDayClick = (date: Date) => {
    const key = toDateKey(date)
    if (missedDateKeys.has(key) || makeupDateKeys.has(key)) return
    setPendingMissedKey((prev) => (prev === key ? null : key))
  }

  const handleDayDoubleClick = (date: Date) => {
    const key = toDateKey(date)
    if (!pendingMissedKey || pendingMissedKey === key) return
    setState((s) => ({
      ...s,
      makeupDays: [...s.makeupDays, { missedDate: pendingMissedKey, makeupDate: key }],
    }))
    setPendingMissedKey(null)
  }

  const removeMakeupPair = (index: number) =>
    setState((s) => ({ ...s, makeupDays: s.makeupDays.filter((_, i) => i !== index) }))

  function MakeupDayButton(props: ComponentProps<typeof DayButton>) {
    const key = toDateKey(props.day.date)
    const isMakeup = makeupDateKeys.has(key)
    const isMissed = missedDateKeys.has(key) || pendingMissedKey === key
    return (
      <CalendarDayButton
        {...props}
        onClick={(e) => {
          props.onClick?.(e)
          handleDayClick(props.day.date)
        }}
        onDoubleClick={() => handleDayDoubleClick(props.day.date)}
        className={cn(
          props.className,
          isMakeup &&
            "bg-red-500 text-white hover:bg-red-500 hover:text-white dark:bg-red-600 dark:hover:bg-red-600",
          isMissed &&
            !isMakeup &&
            "bg-amber-400 text-white hover:bg-amber-400 hover:text-white dark:bg-amber-500 dark:hover:bg-amber-500",
        )}
      />
    )
  }

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
        </div>
      </SectionCard>

      <SectionCard
        title="Makeup days"
        description="Click a date this member is expected to miss, then double-click another date to pick the day they'll work instead."
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Calendar components={{ DayButton: MakeupDayButton }} />
          <div className="min-w-0 flex-1 space-y-2">
            {makeupDays.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No makeup days set.</p>
            ) : (
              makeupDays.map((pair, i) => (
                <div
                  key={`${pair.missedDate}-${pair.makeupDate}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {formatDisplayDate(pair.missedDate)}
                    </span>
                    {" → "}
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {formatDisplayDate(pair.makeupDate)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMakeupPair(i)}
                    className="text-xs font-medium text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
            {pendingMissedKey ? (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {formatDisplayDate(pendingMissedKey)} marked as missed — double-click the makeup day.
              </p>
            ) : null}
          </div>
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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{WORK_LIMITS_EXCLUSION_HINT}</p>
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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{WORK_LIMITS_EXCLUSION_HINT}</p>
          ) : null}
        </SectionCard>
      </div>

      {bothActive ? (
        <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-800 dark:text-red-300" role="alert">
          {WORK_LIMITS_EXCLUSION_HINT}
        </div>
      ) : null}

      <SectionCard title="Tracking restrictions">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Disable time tracking on specific days</span>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">When enabled, tracking can be blocked on selected days.</p>
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
