"use client"

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useAuth } from "@/shared/providers/app"
import { fetchAgentStatus, type ActivityCaptureMode, type AgentStatus } from "@/features/activity/services/activity-api"
import type { AgentTimerReadiness } from "@/features/activity/utils/agent-timer-gate"
import { isBackendRateLimited } from "@/infrastructure/api/backend-connection-events"

interface AgentStatusContextValue {
  captureMode: ActivityCaptureMode
  isAgentMode: boolean
  isLocalAgentRunning: boolean
  isLocalAgentAuthenticated: boolean
  isAgentLinked: boolean
  agentIngestEnabled: boolean
  authPort: number
  linkedAt: string | null
  agentSource: string | null
  canStartTimer: boolean
  refreshAgentStatus: () => Promise<AgentTimerReadiness>
}

const AgentStatusContext = createContext<AgentStatusContextValue | undefined>(undefined)

const POLL_MS = 8_000

export function useAgentStatus() {
  const ctx = useContext(AgentStatusContext)
  if (!ctx) throw new Error("useAgentStatus must be used within AgentStatusProvider")
  return ctx
}

export function AgentStatusProvider({
  children,
  deferPollingUntilRefresh = false,
}: {
  children: ReactNode
  deferPollingUntilRefresh?: boolean
}) {
  const { isLoggedIn } = useAuth()
  const [remote, setRemote] = useState<AgentStatus | null>(null)
  const [pollingArmed, setPollingArmed] = useState(!deferPollingUntilRefresh)

  const authPort = remote?.authPort ?? 17389
  const captureMode = remote?.captureMode ?? "agent"
  const isAgentMode = captureMode === "agent"
  const isAgentLinked = Boolean(remote?.linkedAt)
  const agentIngestEnabled = remote?.agentIngestEnabled ?? false
  const isLocalAgentRunning = remote?.agentOnline === true
  const isLocalAgentAuthenticated = isLocalAgentRunning && isAgentLinked

  const refreshAgentStatus = useCallback(async (): Promise<AgentTimerReadiness> => {
    if (!isLoggedIn) {
      setRemote(null)
      return {
        canStartTimer: false,
        isLocalAgentRunning: false,
        isLocalAgentAuthenticated: false,
        isAgentLinked: false,
        agentIngestEnabled: false,
      }
    }
    setPollingArmed(true)
    const status = await fetchAgentStatus()
    if (status) setRemote(status)
    const running = status?.agentOnline === true
    const linked = Boolean(status?.linkedAt)
    const authenticated = running && linked
    const ingest = status?.agentIngestEnabled ?? false
    return {
      canStartTimer: running && authenticated && ingest,
      isLocalAgentRunning: running,
      isLocalAgentAuthenticated: authenticated,
      isAgentLinked: linked,
      agentIngestEnabled: ingest,
    }
  }, [isLoggedIn])

  useEffect(() => {
    if (deferPollingUntilRefresh) return
    void refreshAgentStatus()
  }, [deferPollingUntilRefresh, refreshAgentStatus])

  useEffect(() => {
    if (!deferPollingUntilRefresh) return
    if (pollingArmed) {
      void refreshAgentStatus()
    }
  }, [deferPollingUntilRefresh, pollingArmed, refreshAgentStatus])

  useEffect(() => {
    if (!isLoggedIn || !pollingArmed) return
    const timer = setInterval(() => {
      if (isBackendRateLimited()) return
      void fetchAgentStatus().then((status) => {
        if (status) setRemote(status)
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [isLoggedIn, pollingArmed])

  useEffect(() => {
    const onLinked = () => void refreshAgentStatus()
    window.addEventListener("vt-agent-linked", onLinked)
    return () => window.removeEventListener("vt-agent-linked", onLinked)
  }, [refreshAgentStatus])

  const canStartTimer = isLocalAgentRunning && isLocalAgentAuthenticated && agentIngestEnabled

  const value = useMemo<AgentStatusContextValue>(
    () => ({
      captureMode,
      isAgentMode,
      isLocalAgentRunning,
      isLocalAgentAuthenticated,
      isAgentLinked,
      agentIngestEnabled,
      authPort,
      linkedAt: remote?.linkedAt ?? null,
      agentSource: remote?.agentSource ?? null,
      canStartTimer,
      refreshAgentStatus,
    }),
    [
      captureMode,
      isAgentMode,
      isLocalAgentRunning,
      isLocalAgentAuthenticated,
      isAgentLinked,
      agentIngestEnabled,
      authPort,
      remote?.linkedAt,
      remote?.agentSource,
      canStartTimer,
      refreshAgentStatus,
    ],
  )

  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>
}
