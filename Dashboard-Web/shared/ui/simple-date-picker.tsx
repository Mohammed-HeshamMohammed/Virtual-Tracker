"use client"

import { DatePickerField } from "@/shared/ui/forms/date-picker-field"
import { cn } from "@/shared/utils/utils"

type SimpleDatePickerProps = {
  value: string
  onChange: (iso: string) => void
  placeholder?: string
  disabled?: boolean
  "aria-label"?: string
}

export function SimpleDatePicker({
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
  "aria-label": ariaLabel,
}: SimpleDatePickerProps) {
  return (
    <div
      className={cn(disabled && "pointer-events-none opacity-60")}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
    >
      <DatePickerField value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  )
}
