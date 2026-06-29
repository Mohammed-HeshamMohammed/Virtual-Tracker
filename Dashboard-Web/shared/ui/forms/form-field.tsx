"use client"

import { cn } from "@/shared/utils/utils"
import { FORM_FIELD, useClientFormTheme } from "@/shared/ui/forms/form-styles"
import { FieldLabel } from "@/shared/ui/forms/field-label"

export function FormField({
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string | null
  className?: string
  children: React.ReactNode
}) {
  const theme = useClientFormTheme()
  return (
    <div className={cn(FORM_FIELD, className)}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {hint ? <p className={theme.hint}>{hint}</p> : null}
    </div>
  )
}
