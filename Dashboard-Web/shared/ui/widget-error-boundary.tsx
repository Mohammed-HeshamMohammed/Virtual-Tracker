"use client"

import React, { Component, type ReactNode } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { DashboardStatusPanel } from "@/shared/ui/errors/dashboard-status-panel"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"

type WidgetErrorBoundaryProps = {
  children: ReactNode
  label?: string
  onRetry?: () => void
  isDark?: boolean
}

type WidgetErrorBoundaryState = {
  error: Error | null
}

function WidgetErrorFallback({
  label,
  onRetry,
  isDark = false,
}: {
  label: string
  onRetry: () => void
  isDark?: boolean
}) {
  return (
    <DashboardStatusPanel isDark={isDark} className="flex min-h-[180px] items-center justify-center p-6">
      <DashboardStatusContent
        isDark={isDark}
        icon={AlertCircle}
        iconTone="warning"
        title={`${label} failed to load`}
        description="Other dashboard sections are still available."
        primaryLabel="Retry section"
        primaryIcon={RefreshCw}
        onPrimary={onRetry}
      />
    </DashboardStatusPanel>
  )
}

export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  state: WidgetErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error }
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
    this.props.onRetry?.()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const label = this.props.label ?? "This section"
    return (
      <WidgetErrorFallback label={label} onRetry={this.handleRetry} isDark={this.props.isDark} />
    )
  }
}

export function WidgetErrorState({
  label = "This section",
  isDark = false,
  onRetry,
}: {
  label?: string
  isDark?: boolean
  onRetry: () => void
}) {
  return <WidgetErrorFallback label={label} onRetry={onRetry} isDark={isDark} />
}
