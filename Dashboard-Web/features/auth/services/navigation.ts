import { broadcastAgentLinked, pingDashboardTab } from "@/features/auth/services/agent-link-broadcast"

export const DASHBOARD_PATH = "/"

export function buildAgentAuthUrl(linkToken: string): string {
  return `/?link=${encodeURIComponent(linkToken)}`
}

// An <a> click (rather than window.location.href) so an unregistered scheme
// doesn't flash a "not found" navigation in the address bar - it's just
// silently ignored by the browser when no handler is registered. Exported so
// both the auto-fire-on-success call sites and an explicit "Connect" button
// (for when the browser blocked the auto-fire, e.g. the user dismissed the
// "Open Virtual Tracker Agent?" prompt) can trigger the same thing.
export function openDesktopAgentDeepLink(): void {
  try {
    const link = document.createElement("a")
    link.href = "virtualtracker://link-complete"
    link.click()
  } catch {
    /* ignore - best-effort only, the poll/loopback exchange already did the real work */
  }
}

export type AgentLinkFinishResult = "existing-tab" | "no-tab"

/** After agent link — focus existing tab or stay here. */
export async function finishAgentLinkSuccess(): Promise<AgentLinkFinishResult> {
  if (typeof window === "undefined") return "no-tab"

  const dashboardOpen = await pingDashboardTab()
  broadcastAgentLinked()

  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage({ type: "vt-agent-linked" }, window.location.origin)
      window.opener.focus()
    } catch {
      /* ignore */
    }
  }

  try {
    window.close()
  } catch {
    /* browsers block close for tabs with more than one history entry; the
       caller falls back to showing an explicit "you can close this tab" screen */
  }

  return dashboardOpen ? "existing-tab" : "no-tab"
}
