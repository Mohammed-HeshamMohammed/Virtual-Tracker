"use client"

import { cn } from "@/shared/utils/utils"
import { useClientFormTheme } from "@/shared/ui/forms/form-styles"

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}) {
  const theme = useClientFormTheme()

  return (
    <label className="inline-flex shrink-0 cursor-pointer select-none items-center gap-2.5">
      <span className="relative inline-block h-[2em] w-[3.5em] text-[12px] leading-none">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 cursor-pointer rounded-[30px] border transition-[background-color,border-color,box-shadow] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            "before:absolute before:bottom-[0.25em] before:left-[0.27em] before:h-[1.4em] before:w-[1.4em] before:rounded-[20px] before:transition-[transform,background-color] before:duration-[320ms] before:ease-[cubic-bezier(0.22,1,0.36,1)] before:content-['']",
            "peer-focus-visible:shadow-[0_0_1px_#007bff]",
            theme.isDark
              ? "border-[#3d4a3d] bg-[#151b2d] before:bg-[#8a9588] peer-checked:border-[#4be277] peer-checked:bg-[#4be277] peer-checked:before:translate-x-[1.4em] peer-checked:before:bg-white"
              : "border-[#adb5bd] bg-white before:bg-[#adb5bd] peer-checked:border-[#007bff] peer-checked:bg-[#007bff] peer-checked:before:translate-x-[1.4em] peer-checked:before:bg-white",
          )}
        />
      </span>
      {label ? <span className={cn("text-sm", theme.page.modalText)}>{label}</span> : null}
    </label>
  )
}
