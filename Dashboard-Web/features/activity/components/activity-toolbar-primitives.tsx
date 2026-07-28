"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"
import type { LucideIcon } from "lucide-react"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

export function ActivityToolbarDivider({ className }: { className?: string }) {
  return <div className={cn("hidden h-6 w-px shrink-0 bg-slate-200/80 dark:bg-slate-800 sm:block", className)} aria-hidden />
}

export function ActivityToolbarIconButton({
  onClick,
  title,
  ariaLabel,
  ariaPressed,
  disabled,
  active,
  activeClassName,
  children,
  className,
  showTooltip = true,
  tooltipPlacement = "top",
}: {
  onClick: () => void
  title: string
  ariaLabel: string
  ariaPressed?: boolean
  disabled?: boolean
  active?: boolean
  activeClassName?: string
  children: ReactNode
  className?: string
  showTooltip?: boolean
  tooltipPlacement?: "top" | "bottom" | "left" | "right"
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      title={showTooltip ? undefined : title}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 shadow-sm transition-all hover:bg-slate-100/80 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
        active && (activeClassName ?? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-semibold shadow-emerald-500/10"),
        className,
      )}
    >
      {children}
    </button>
  )

  if (!showTooltip) return button

  return (
    <IconTooltip text={title} placement={tooltipPlacement} multiline={title.length > 28}>
      {button}
    </IconTooltip>
  )
}

export function ActivityToolbarTextButton({
  onClick,
  title,
  ariaLabel,
  ariaPressed,
  disabled,
  active,
  children,
  showTooltip = false,
  tooltipPlacement = "top",
}: {
  onClick: () => void
  title: string
  ariaLabel: string
  ariaPressed?: boolean
  disabled?: boolean
  active?: boolean
  children: ReactNode
  showTooltip?: boolean
  tooltipPlacement?: "top" | "bottom" | "left" | "right"
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      title={showTooltip ? undefined : title}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-all sm:text-sm shadow-sm",
        active
          ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
          : "border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-700/80 hover:text-slate-900 dark:hover:text-white",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  )

  if (!showTooltip) return button

  return (
    <IconTooltip text={title} placement={tooltipPlacement} multiline={title.length > 28}>
      {button}
    </IconTooltip>
  )
}

export function ActivitySegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "sm",
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: LucideIcon }[]
  ariaLabel: string
  size?: "sm" | "md"
}) {
  return (
    <div
      className="flex shrink-0 items-center rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 p-0.5 shadow-inner"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt, index) => {
        const Icon = opt.icon
        const selected = value === opt.value
        return (
          <button
            key={`${String(opt.value)}-${index}`}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all",
              size === "sm" ? "px-2 py-1 text-xs sm:px-2.5" : "px-2.5 py-1.5 text-sm",
              selected
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export const ACTIVITY_CATEGORY_OPTIONS = [
  { id: "all", label: "All", dot: "bg-slate-400 dark:bg-slate-500" },
  { id: "productive", label: "Productive", dot: "bg-emerald-500 dark:bg-emerald-400" },
  { id: "neutral", label: "Neutral", dot: "bg-slate-400 dark:bg-slate-500" },
  { id: "unproductive", label: "Unproductive", dot: "bg-rose-500 dark:bg-rose-400" },
] as const

export function ActivityCategoryFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (cat: string) => void
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 p-0.5 shadow-inner"
      role="group"
      aria-label="Activity category"
    >
      {ACTIVITY_CATEGORY_OPTIONS.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onChange(cat.id)}
          aria-pressed={value === cat.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition-all sm:px-2.5",
            value === cat.id
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
          )}
        >
          {cat.id !== "all" ? (
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cat.dot)} aria-hidden />
          ) : null}
          {cat.label}
        </button>
      ))}
    </div>
  )
}
