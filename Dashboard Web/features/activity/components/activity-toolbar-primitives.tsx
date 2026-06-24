"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"
import type { LucideIcon } from "lucide-react"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

export function ActivityToolbarDivider({ className }: { className?: string }) {
  return <div className={cn("hidden h-6 w-px shrink-0 bg-slate-200 sm:block", className)} aria-hidden />
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
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
        active && (activeClassName ?? "border-emerald-200 bg-emerald-50 text-emerald-700"),
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
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
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
      className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5"
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
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "px-2 py-1 text-xs sm:px-2.5" : "px-2.5 py-1.5 text-sm",
              selected
                ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
                : "text-slate-500 hover:text-slate-700",
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
  { id: "all", label: "All", dot: "bg-slate-400" },
  { id: "productive", label: "Productive", dot: "bg-emerald-500" },
  { id: "neutral", label: "Neutral", dot: "bg-slate-400" },
  { id: "unproductive", label: "Unproductive", dot: "bg-red-500" },
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
      className="flex shrink-0 flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/80 p-0.5"
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
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors sm:px-2.5",
            value === cat.id
              ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:text-slate-700",
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
