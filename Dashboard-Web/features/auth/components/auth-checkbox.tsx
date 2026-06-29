"use client"

import { Check } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { getAuthStyles } from "@/features/auth/components/style-utils"

type AuthCheckboxProps = {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  isDark: boolean
  className?: string
}

export function AuthCheckbox({ id, checked, onChange, label, isDark, className }: AuthCheckboxProps) {
  const u = getAuthStyles(isDark)

  return (
    <label htmlFor={id} className={cn("flex cursor-pointer select-none items-center gap-2.5", className)}>
      <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[5px] border transition-all duration-200",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
            isDark
              ? "border-[#3d4a3d]/50 bg-[#151b2d] peer-focus-visible:ring-[#4be277]/40 peer-focus-visible:ring-offset-[#0c1324] peer-checked:border-[#4be277] peer-checked:bg-[#4be277] peer-checked:shadow-[0_0_12px_rgba(75,226,119,0.35)]"
              : "border-[#cbc3d7]/60 bg-[#f0f4f8] peer-focus-visible:ring-[#6b38d4]/30 peer-focus-visible:ring-offset-[#f6fafe] peer-checked:border-[#6b38d4] peer-checked:bg-[#6b38d4] peer-checked:shadow-[0_0_12px_rgba(107,56,212,0.25)]",
          )}
        />
        <Check
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 transition-opacity duration-150",
            "peer-checked:opacity-100",
          )}
          strokeWidth={3}
        />
      </span>
      <span className={cn("text-sm", u.body)}>{label}</span>
    </label>
  )
}
