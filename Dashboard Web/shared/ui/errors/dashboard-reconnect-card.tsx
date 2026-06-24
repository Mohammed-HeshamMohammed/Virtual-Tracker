"use client"

import { RefreshCw, Unplug } from "lucide-react"
import {
  BACKEND_RECONNECTING_HINT,
  BACKEND_RECONNECTING_TITLE,
  BACKEND_RETRY_LABEL,
  BACKEND_UNAVAILABLE_TITLE,
} from "@/infrastructure/api/backend-connection-events"
import { cn } from "@/shared/utils/utils"
import { DashboardStatusPanel } from "@/shared/ui/errors/dashboard-status-panel"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"

type DashboardReconnectCardProps = {
  isDark: boolean
  error: string
  isReconnecting?: boolean
  onRetry?: () => void
  reconnectHint?: string
}

/** Inline reconnect card shown over the dashboard when the backend drops offline. */
export function DashboardReconnectCard({
  isDark,
  error,
  isReconnecting = false,
  onRetry,
  reconnectHint = BACKEND_RECONNECTING_HINT,
}: DashboardReconnectCardProps) {
  const StatusIcon = isReconnecting ? RefreshCw : Unplug

  return (
    <DashboardStatusPanel
      isDark={isDark}
      className={cn(
        "pointer-events-auto mx-auto w-full max-w-md border shadow-2xl",
        isDark
          ? "shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          : "shadow-[0_24px_80px_rgba(15,23,42,0.12)]",
      )}
    >
      <DashboardStatusContent
        isDark={isDark}
        icon={StatusIcon}
        iconTone={isReconnecting ? "loading" : "error"}
        badge={isReconnecting ? "Reconnecting" : "Offline"}
        title={isReconnecting ? BACKEND_RECONNECTING_TITLE : BACKEND_UNAVAILABLE_TITLE}
        description={isReconnecting ? reconnectHint : error}
        primaryLabel={onRetry ? (isReconnecting ? BACKEND_RECONNECTING_TITLE : BACKEND_RETRY_LABEL) : undefined}
        primaryIcon={RefreshCw}
        primaryDisabled={isReconnecting}
        onPrimary={onRetry}
      />
    </DashboardStatusPanel>
  )
}
