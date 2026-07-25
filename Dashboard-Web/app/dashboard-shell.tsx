"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppShellReady } from "@/features/auth"
import { useAuth, useTheme } from "@/shared/providers/app"
import { coerceNavItemForRole } from "@/features/auth"
import { registerDashboardPresence, subscribeAgentLinked } from "@/features/auth"
import { useBackendConnectionMonitor } from "@/features/auth/hooks/use-backend-connection-monitor"
import { AuthSessionLoader } from "@/features/auth"
import { DashboardReconnectOverlay } from "@/shared/ui/errors/dashboard-reconnect-overlay"
import { BACKEND_RECONNECTING_HINT, BACKEND_UNAVAILABLE_MESSAGE } from "@/infrastructure/api/backend-connection-events"
import { cn } from "@/shared/utils/utils"
import { Sidebar, Topbar, PageSearchProvider } from "@/shared/ui/layout"
import { HierarchyAssignmentBanner } from "@/shared/ui/layout/hierarchy-assignment-banner"
import { configureTimerStorageScope, clearAllTaskTimerStateForScope } from "@/features/activity/utils/timer-task-storage"
import { PageContent } from "@/app/page-content"
import { isFullBleedPage } from "@/app/page-layout"
import { prefetchAppRoutesForRole } from "@/app/prefetch-routes"
import { ActivityRuntimeProvider } from "@/features/activity"

export function DashboardShell() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const { isDark } = useTheme()
  const { isLoggedIn, sessionReady, memberRole, sessionStatusMessage, sessionConnectionError, retryConnection, backendReconnecting, initError, memberId } = useAuth()
  const { activeItem, setActiveItem: setActiveItemRaw, shellReady } =
    useAppShellReady({ sessionReady, isLoggedIn, memberRole })

  useBackendConnectionMonitor(isLoggedIn && sessionReady)

  const setActiveItem = useCallback(
    (id: string) => {
      setActiveItemRaw(coerceNavItemForRole(id, memberRole))
    },
    [memberRole, setActiveItemRaw],
  )

  useEffect(() => {
    configureTimerStorageScope(memberId)
    if (!memberId) {
      clearAllTaskTimerStateForScope()
    }
  }, [memberId])

  useEffect(() => {
    if (!shellReady || !isLoggedIn) return
    prefetchAppRoutesForRole(memberRole)
  }, [shellReady, isLoggedIn, memberRole])

  useEffect(() => {
    const unregisterPresence = registerDashboardPresence()
    const unsubscribeLinked = subscribeAgentLinked(() => {
      window.focus()
    })
    return () => {
      unregisterPresence()
      unsubscribeLinked()
    }
  }, [])

  if (!isLoggedIn || !sessionReady) {
    return (
      <AuthSessionLoader
        message={
          sessionStatusMessage ??
          (isLoggedIn ? "Checking your session..." : "Signing you in...")
        }
        error={sessionConnectionError ?? initError}
        onRetry={sessionConnectionError || initError ? () => retryConnection() : undefined}
      />
    )
  }

  const showReconnectOverlay = Boolean(sessionConnectionError || initError || backendReconnecting)

  return (
    <ActivityRuntimeProvider>
      <DashboardReconnectOverlay
        open={showReconnectOverlay}
        isDark={isDark}
        error={sessionConnectionError ?? initError ?? BACKEND_UNAVAILABLE_MESSAGE}
        isReconnecting={backendReconnecting}
        onRetry={() => retryConnection()}
        reconnectHint={BACKEND_RECONNECTING_HINT}
      />
      <PageSearchProvider activePageId={activeItem}>
      <div
        className={cn(
          "relative flex h-full min-h-0 flex-1 overflow-hidden transition-colors duration-300",
          isDark ? "bg-[#151b2d]" : "bg-[#f0f4f8]",
        )}
      >
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((p) => !p)}
          activeItem={activeItem}
          onNavigate={setActiveItem}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar
            activeItem={activeItem}
            onNavigate={setActiveItem}
            isCollapsed={!isSidebarCollapsed}
          />
          <HierarchyAssignmentBanner />
          <main className="w-full flex-1 overflow-hidden p-8">
            <div
              className={cn(
                "scrollbar-hide h-full w-full max-w-full rounded-3xl p-8 transition-colors duration-300",
                isFullBleedPage(activeItem) ? "overflow-hidden" : "overflow-y-auto",
                isDark
                  ? "bg-[#101417] shadow-[0_8px_40px_0_rgba(75,226,119,0.04)]"
                  : "bg-[#ffffff] shadow-lg",
              )}
            >
              <PageContent activeItem={activeItem} onNavigate={setActiveItem} />
            </div>
          </main>
        </div>
      </div>
    </PageSearchProvider>
    </ActivityRuntimeProvider>
  )
}
