"use client"

import { useEffect } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { AgentDownloadChoices } from "@/shared/ui/agent-download-choices"
import { useAgentStatus } from "@/features/activity/components/agent-status-context"

function agentLinkedAgo(linkedAt: string | null): string | null {
  if (!linkedAt) return null
  const d = new Date(linkedAt)
  if (!Number.isFinite(d.getTime())) return null
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  return `on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

function AgentStatusCard({ isDark }: { isDark: boolean }) {
  const { isLocalAgentRunning, isAgentLinked, linkedAt, agentPresence, refreshAgentStatus } = useAgentStatus()
  const connected = isLocalAgentRunning && isAgentLinked
  // A failed status check is not the agent being gone - say "checking" rather
  // than "not running" (PLAN-timer-stop-resilience.md A3).
  const checking = !connected && agentPresence === "unknown"
  const linkedAgo = agentLinkedAgo(linkedAt)

  // The top-bar button used to fetch this on every page. It no longer touches
  // the agent at all, so this page asks for itself.
  useEffect(() => {
    void refreshAgentStatus()
  }, [refreshAgentStatus])

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-4 shadow-sm backdrop-blur-xl",
        connected
          ? isDark
            ? "border-emerald-900/60 bg-emerald-950/30"
            : "border-emerald-200 bg-emerald-50"
          : checking
            ? isDark
              ? "border-slate-800 bg-slate-900/60"
              : "border-slate-200 bg-slate-50"
            : isDark
              ? "border-amber-900/60 bg-amber-950/30"
              : "border-amber-200 bg-amber-50",
      )}
    >
      {connected ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : checking ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-500 dark:text-slate-400" />
      ) : (
        <XCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      )}
      <div className="min-w-0">
        <p className={cn("text-sm font-semibold", isDark ? "text-slate-100" : "text-slate-900")}>
          {connected ? "Agent connected" : checking ? "Checking the agent…" : "Agent not running"}
        </p>
        <p className={cn("mt-0.5 text-xs", isDark ? "text-slate-400" : "text-slate-600")}>
          {connected
            ? linkedAgo
              ? `Last linked ${linkedAgo}`
              : "Ready to track time"
            : checking
              ? "Couldn't confirm its status just now - checking again."
              : "Install it below and sign in. Tracking starts and stops in the agent."}
        </p>
      </div>
    </div>
  )
}

export function ActivityToolsPage() {
  const { isDark } = useTheme()

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto px-1 py-1">
      <h1 className={cn("text-xl font-bold tracking-tight sm:text-2xl", isDark ? "text-slate-100" : "text-slate-900")}>
        Tools
      </h1>

      <AgentStatusCard isDark={isDark} />

      <div
        className={cn(
          "flex flex-col gap-5 rounded-2xl border p-6 shadow-sm transition-all backdrop-blur-xl",
          isDark
            ? "border-slate-800 bg-slate-900/80 shadow-slate-950/20"
            : "border-slate-200/80 bg-white/90 shadow-slate-900/5",
        )}
      >
        <div className="min-w-0">
          <h2 className={cn("text-base font-bold tracking-tight", isDark ? "text-slate-100" : "text-slate-900")}>
            Agent Tracker setup
          </h2>
          <p className={cn("mt-1 text-sm leading-relaxed", isDark ? "text-slate-400" : "text-slate-600")}>
            Time is tracked by the Virtual Tracker Agent. Download the installer for your OS, install it, sign
            in, then start and stop tracking from the agent.
          </p>
        </div>

        <AgentDownloadChoices compact className={isDark ? "" : "[&_a]:border-slate-200 [&_a]:bg-slate-50 [&_a]:text-slate-800 [&_a:hover]:bg-white"} />
      </div>
    </div>
  )
}
