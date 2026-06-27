"use client"

import type { ReactNode } from "react"
import ErrorBoundary from "./ErrorBoundary"

export default function SafeSection({
  name,
  children,
  className = "",
}: {
  name: string
  children: ReactNode
  className?: string
}) {
  return (
    <ErrorBoundary section={name}>
      <div className={className}>{children}</div>
    </ErrorBoundary>
  )
}
