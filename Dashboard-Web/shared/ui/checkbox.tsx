"use client"

import { cn } from "@/shared/utils/utils"
import { Check } from "lucide-react"

export function Checkbox({
  checked,
  onChange,
  className,
  isDark = false,
}: {
  checked: boolean
  onChange: () => void
  className?: string
  isDark?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-150",
        checked
          ? isDark ? "border-[#4be277] bg-[#4be277] text-[#0c1324]" : "border-blue-500 bg-blue-500 text-white"
          : isDark ? "border-[#3d4a3d] bg-[#151b2d] hover:border-[#bccbb9]" : "border-slate-300 bg-white hover:border-slate-400",
        className,
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  )
}
