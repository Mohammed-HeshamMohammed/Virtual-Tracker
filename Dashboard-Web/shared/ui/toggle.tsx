"use client"

import { cn } from "@/shared/utils/utils"

export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange()
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
        checked ? "bg-blue-500" : "bg-slate-200",
        disabled && "cursor-not-allowed opacity-50",
      )}
      aria-label="Interactive control"
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  )
}
