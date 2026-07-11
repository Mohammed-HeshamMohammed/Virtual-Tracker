export type AgentTimerReadiness = {
  canStartTimer: boolean
  isLocalAgentRunning: boolean
  isLocalAgentAuthenticated: boolean
  isAgentLinked: boolean
  agentIngestEnabled: boolean
}

export function getAgentTimerBlockMessage(readiness: AgentTimerReadiness): string {
  if (!readiness.agentIngestEnabled) {
    return "Desktop agent ingest is disabled on the server. Ask an admin to enable ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED."
  }
  if (!readiness.isLocalAgentRunning) {
    return "Start the Virtual Tracker Agent on this PC, then try again."
  }
  if (!readiness.isLocalAgentAuthenticated) {
    return "Link the desktop agent to your account — open the agent, click Sign In, then click Link this account in the browser."
  }
  return "Virtual Tracker Agent is not connected. Start the agent and sign in, then try again."
}

export const AGENT_TIMER_BLOCKED_EVENT = "vt-timer-agent-blocked"

export function notifyAgentTimerBlocked(message: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(AGENT_TIMER_BLOCKED_EVENT, { detail: { message } }))
}
