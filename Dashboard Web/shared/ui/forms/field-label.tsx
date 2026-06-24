"use client"

import { useClientFormTheme } from "@/shared/ui/forms/form-styles"

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  const theme = useClientFormTheme()
  return (
    <label className={`block ${theme.label} mb-0`}>
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  )
}
