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
import { pingLocalAgent } from "@/features/activity/utils/local-agent"
import type { AgentTimerReadiness } from "@/features/activity/utils/agent-timer-gate"

interface AgentStatusContextValue {
  captureMode: ActivityCaptureMode
  isAgentMode: boolean
  isLocalAgentRunning: boolean
  isAgentLinked: boolean
  agentIngestEnabled: boolean
  authPort: number
  linkedAt: string | null
  agentSource: string | null
  canStartTimer: boolean
  refreshAgentStatus: () => Promise<AgentTimerReadiness>
}

const AgentStatusContext = createContext<AgentStatusContextValue | undefined>(undefined)

const LOCAL_POLL_MS = 5_000
const BACKEND_POLL_MS = 30_000

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
  /** When true, skip agent/status API calls until refreshAgentStatus() runs (timer start). */
  deferPollingUntilRefresh?: boolean
}) {
  const { isLoggedIn } = useAuth()
  const [remote, setRemote] = useState<AgentStatus | null>(null)
  const [isLocalAgentRunning, setIsLocalAgentRunning] = useState(false)
  const [pollingArmed, setPollingArmed] = useState(!deferPollingUntilRefresh)

  const authPort = remote?.authPort ?? 17389
  const captureMode = remote?.captureMode ?? "agent"
  const isAgentMode = captureMode === "agent"
  const isAgentLinked = Boolean(remote?.linkedAt)
  const agentIngestEnabled = remote?.agentIngestEnabled ?? false

  const refreshAgentStatus = useCallback(async (): Promise<AgentTimerReadiness> => {
    if (!isLoggedIn) {
      setRemote(null)
      setIsLocalAgentRunning(false)
      return {
        canStartTimer: false,
        isLocalAgentRunning: false,
        isAgentLinked: false,
        agentIngestEnabled: false,
      }
    }
    setPollingArmed(true)
    const status = await fetchAgentStatus()
    const port = status?.authPort ?? 17389
    const localOk = await pingLocalAgent(port)
    if (status) setRemote(status)
    setIsLocalAgentRunning(localOk)
    const ingest = status?.agentIngestEnabled ?? false
    const linked = Boolean(status?.linkedAt)
    const canStart = localOk && ingest && linked
    return {
      canStartTimer: canStart,
      isLocalAgentRunning: localOk,
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
    const localTimer = setInterval(() => {
      void pingLocalAgent(authPort).then(setIsLocalAgentRunning)
    }, LOCAL_POLL_MS)
    const remoteTimer = setInterval(() => {
      void fetchAgentStatus().then((status) => {
        if (status) setRemote(status)
      })
    }, BACKEND_POLL_MS)
    return () => {
      clearInterval(localTimer)
      clearInterval(remoteTimer)
    }
  }, [isLoggedIn, authPort, pollingArmed])

  useEffect(() => {
    const onLinked = () => void refreshAgentStatus()
    window.addEventListener("vt-agent-linked", onLinked)
    return () => window.removeEventListener("vt-agent-linked", onLinked)
  }, [refreshAgentStatus])

  const canStartTimer = isLocalAgentRunning && agentIngestEnabled && isAgentLinked

  const value = useMemo<AgentStatusContextValue>(
    () => ({
      captureMode,
      isAgentMode,
      isLocalAgentRunning,
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
