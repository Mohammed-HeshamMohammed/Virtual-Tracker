"use client"

import { useClientFormTheme } from "@/shared/ui/forms/form-styles"

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  const theme = useClientFormTheme()
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={theme.control} aria-label="Interactive control"
    />
  )
}
