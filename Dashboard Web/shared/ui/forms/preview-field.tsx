"use client"

import { useClientFormTheme } from "@/shared/ui/forms/form-styles"

export function PreviewField({
  value,
  placeholder = "—",
}: {
  value: string
  placeholder?: string
}) {
  const theme = useClientFormTheme()
  return (
    <div className={`flex items-center ${theme.preview}`}>
      {value.trim() ? value : <span className={theme.hint}>{placeholder}</span>}
    </div>
  )
}
