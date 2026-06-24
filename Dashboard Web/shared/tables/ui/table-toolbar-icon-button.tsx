"use client"

import type { ReactNode } from "react"
import { cn } from "@/shared/utils/utils"
import { IconTooltip } from "@/shared/ui/forms/icon-tooltip"

export type PeopleToolbarIconButtonProps = {
  onClick: () => void
  disabled?: boolean
  isDark?: boolean
  title: string
  children: ReactNode
  className?: string
}

export function tableToolbarIconButtonClass(isDark: boolean, className?: string) {
  return cn(
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    isDark
      ? "border-[#3d4a3d]/40 bg-[#191f31] text-[#bccbb9] hover:bg-[#2e3447]"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    className,
  )
}

export function TableToolbarIconButton({
  onClick,
  disabled = false,
  isDark = false,
  title,
  children,
  className,
}: PeopleToolbarIconButtonProps) {
  return (
    <IconTooltip text={title} placement="bottom">
      <button
        type="button"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        className={tableToolbarIconButtonClass(isDark, className)}
      >
        {children}
      </button>
    </IconTooltip>
  )
}
