"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"

export type DashboardStatusIconTone = "default" | "error" | "warning" | "success" | "loading"

type DashboardStatusContentProps = {
  isDark: boolean
  icon: LucideIcon
  iconTone?: DashboardStatusIconTone
  badge?: string
  title: string
  subtitle?: string
  description: string
  align?: "center" | "left"
  primaryLabel?: string
  onPrimary?: () => void
  primaryIcon?: LucideIcon
  primaryDisabled?: boolean
  secondaryLabel?: string
  onSecondary?: () => void
  secondaryIcon?: LucideIcon
  secondaryDisabled?: boolean
  secondaryComingSoon?: boolean
  footer?: ReactNode
  children?: ReactNode
}

function iconToneClass(isDark: boolean, tone: DashboardStatusIconTone): string {
  const t = getDashboardStatusStyles(isDark)
  switch (tone) {
    case "error":
    case "warning":
      return t.iconPanelError
    case "success":
      return isDark
        ? "border-[#4be277]/20 bg-[#4be277]/10 text-[#4be277]"
        : "border-blue-200 bg-blue-50 text-blue-600"
    case "loading":
      return cn(t.iconPanel, t.iconPanelLoading)
    default:
      return t.iconPanel
  }
}

export function DashboardStatusContent({
  isDark,
  icon: Icon,
  iconTone = "default",
  badge,
  title,
  subtitle,
  description,
  align = "center",
  primaryLabel,
  onPrimary,
  primaryIcon: PrimaryIcon,
  primaryDisabled = false,
  secondaryLabel,
  onSecondary,
  secondaryIcon: SecondaryIcon,
  secondaryDisabled = false,
  secondaryComingSoon = false,
  footer,
  children,
}: DashboardStatusContentProps) {
  const t = getDashboardStatusStyles(isDark)
  const centered = align === "center"
  const secondaryLocked = secondaryDisabled || secondaryComingSoon

  return (
    <div className={cn("flex flex-col", centered ? "items-center text-center" : "items-start text-left")}>
      {badge ? (
        <span className={cn("mb-4 inline-flex rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider", t.badge)}>
          {badge}
        </span>
      ) : null}

      <div
        className={cn(
          "mb-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border",
          iconToneClass(isDark, iconTone),
        )}
      >
        <Icon className={cn("h-7 w-7", iconTone === "loading" && "animate-spin")} aria-hidden />
      </div>

      <div className={cn("w-full max-w-lg", centered && "mx-auto")}>
        {subtitle ? (
          <p className={cn("mb-1 text-xs font-semibold uppercase tracking-wider", t.bodySub)}>{subtitle}</p>
        ) : null}
        <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", t.heading)}>{title}</h1>
        <p className={cn("mt-2 wrap-break-word text-sm leading-relaxed", t.body)}>{description}</p>
      </div>

      {children}

      {primaryLabel || secondaryLabel ? (
        <div
          className={cn(
            "mt-6 flex w-full flex-col gap-3 sm:flex-row",
            centered ? "justify-center" : "justify-start",
          )}
        >
          {primaryLabel && onPrimary ? (
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50",
                t.btnPrimary,
              )}
            >
              {PrimaryIcon ? <PrimaryIcon className={cn("h-4 w-4", primaryDisabled && "animate-spin")} /> : null}
              {primaryLabel}
            </button>
          ) : null}
          {secondaryLabel ? (
            secondaryComingSoon ? (
              <IconTooltip text="Return to home — coming soon" placement="top">
                <button
                  type="button"
                  onClick={secondaryLocked ? undefined : onSecondary}
                  disabled={secondaryLocked}
                  aria-disabled={secondaryLocked}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                    t.btnSecondary,
                    secondaryLocked
                      ? "cursor-not-allowed opacity-60"
                      : "hover:-translate-y-0.5 active:translate-y-0",
                  )}
                >
                  {SecondaryIcon ? <SecondaryIcon className="h-4 w-4" /> : null}
                  {secondaryLabel}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      isDark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-800",
                    )}
                  >
                    Coming soon
                  </span>
                </button>
              </IconTooltip>
            ) : (
              <button
                type="button"
                onClick={secondaryLocked ? undefined : onSecondary}
                disabled={secondaryLocked}
                aria-disabled={secondaryLocked}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                  t.btnSecondary,
                  secondaryLocked
                    ? "cursor-not-allowed opacity-60"
                    : "hover:-translate-y-0.5 active:translate-y-0",
                )}
              >
                {SecondaryIcon ? <SecondaryIcon className="h-4 w-4" /> : null}
                {secondaryLabel}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {footer ? <div className={cn("mt-8 w-full", centered && "mx-auto max-w-xl")}>{footer}</div> : null}
    </div>
  )
}
