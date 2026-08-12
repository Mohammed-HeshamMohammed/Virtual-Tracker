"use client"

import { CheckCircle2, Loader2 } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { cn } from "@/shared/utils/utils"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { useAgentConnectAndAutoClose } from "@/features/auth/services/use-agent-connect"

/** Dedicated full-page takeover for "the desktop agent just linked" - not a
 * banner squeezed into the login card. Fires the virtualtracker:// deep link
 * on mount and auto-closes this tab once the OS actually hands off to the
 * agent; if that doesn't happen within a couple seconds, reveals a manual
 * "Connect" button instead of leaving the user stuck on a blank success page. */
export function AgentLinkedSuccessScreen({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  const { isDark } = useTheme()
  const t = getDashboardStatusStyles(isDark)
  const { showFallback, connect } = useAgentConnectAndAutoClose(true)

  return (
    <DashboardStatusShell isDark={isDark} mode="page" showBrand>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className={cn("flex h-16 w-16 items-center justify-center rounded-2xl border", t.iconPanel)}>
          {showFallback ? (
            <CheckCircle2 className="h-8 w-8" />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin" />
          )}
        </div>

        <div className="space-y-2">
          <h1 className={cn("text-lg font-semibold", t.heading)}>Desktop agent linked</h1>
          <p className={cn("text-sm", t.body)}>
            {showFallback
              ? "This tab didn't close on its own. Click below to open Virtual Tracker Agent."
              : "Connecting to Virtual Tracker Agent and closing this tab…"}
          </p>
        </div>

        <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
          {showFallback ? (
            <button
              type="button"
              onClick={() => {
                connect()
                try {
                  window.close()
                } catch {
                  /* ignore */
                }
              }}
              className={cn("w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors", t.btnPrimary)}
            >
              Connect to Virtual Tracker Agent
            </button>
          ) : null}
          <button
            type="button"
            onClick={onGoToDashboard}
            className={cn("w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors", t.btnSecondary)}
          >
            Go to dashboard instead
          </button>
        </div>
      </div>
    </DashboardStatusShell>
  )
}
