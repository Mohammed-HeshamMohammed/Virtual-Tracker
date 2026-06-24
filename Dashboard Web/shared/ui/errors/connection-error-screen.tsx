"use client"

import { Home, RefreshCw, Unplug } from "lucide-react"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"
import { DashboardReconnectCard } from "@/shared/ui/errors/dashboard-reconnect-card"
import {
  BACKEND_RECONNECTING_HINT,
  BACKEND_RECONNECTING_TITLE,
  BACKEND_RETRY_LABEL,
  BACKEND_RETURN_HOME_LABEL,
  BACKEND_UNAVAILABLE_TITLE,
} from "@/infrastructure/api/backend-connection-events"

export type ConnectionErrorScreenProps = {
  error: string
  isDark: boolean
  isReconnecting?: boolean
  onRetry?: () => void
  variant?: "page" | "overlay" | "inline"
  showGoHome?: boolean
  reconnectHint?: string
}

export function ConnectionErrorScreen({
  error,
  isDark,
  isReconnecting = false,
  onRetry,
  variant = "page",
  showGoHome = true,
  reconnectHint = BACKEND_RECONNECTING_HINT,
}: ConnectionErrorScreenProps) {
  if (variant === "inline") {
    return (
      <DashboardReconnectCard
        isDark={isDark}
        error={error}
        isReconnecting={isReconnecting}
        onRetry={onRetry}
        reconnectHint={reconnectHint}
      />
    )
  }

  const content = (
    <DashboardStatusContent
      isDark={isDark}
      icon={Unplug}
      iconTone={isReconnecting ? "loading" : "error"}
      badge={isReconnecting ? "Reconnecting" : "Offline"}
      title={isReconnecting ? BACKEND_RECONNECTING_TITLE : BACKEND_UNAVAILABLE_TITLE}
      description={isReconnecting ? reconnectHint : error}
      primaryLabel={onRetry ? (isReconnecting ? BACKEND_RECONNECTING_TITLE : BACKEND_RETRY_LABEL) : undefined}
      primaryIcon={RefreshCw}
      primaryDisabled={isReconnecting}
      onPrimary={onRetry}
      secondaryLabel={showGoHome ? BACKEND_RETURN_HOME_LABEL : undefined}
      secondaryIcon={Home}
      secondaryComingSoon={showGoHome}
      secondaryDisabled
    />
  )

  if (variant === "overlay") {
    return (
      <DashboardStatusShell isDark={isDark} mode="overlay" showBrand={false}>
        {content}
      </DashboardStatusShell>
    )
  }

  return (
    <DashboardStatusShell isDark={isDark} mode="page">
      {content}
    </DashboardStatusShell>
  )
}
