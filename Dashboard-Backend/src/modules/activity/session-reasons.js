/**
 * Why an activity session stopped, paused or resumed.
 *
 * Until this existed nothing recorded the cause of a stop. `stop_note` is the
 * member's own text; the agent wrote its reasons to a local log file; the
 * dashboard and the server's sweeps recorded nothing at all. So every "my timer
 * stopped by itself" report began as a fresh investigation, reasoning from code
 * about which of twenty paths might have fired. Each path now names itself.
 *
 * Unknown or missing values become `unspecified` rather than being rejected:
 * an agent from before this change must keep working, and the share of
 * `unspecified` rows is how far the fleet still has to update.
 */
export const SESSION_REASON_LABELS = Object.freeze({
  member_start: "Started by the member",
  member_resume: "Resumed by the member",
  member_pause: "Paused by the member",
  member_stop: "Stopped by the member",
  dashboard_signout: "Signed out of the dashboard",
  agent_quit: "Agent closed",
  agent_signout: "Signed out of the agent",
  agent_relink: "Agent re-linked to an account",
  idle_escalation: "Idle past the project's allowance",
  timer_cap: "Task's daily hour limit reached",
  budget_cap: "Project budget limit reached",
  agent_absent: "Agent not seen for over a minute",
  agent_returned: "Agent checked back in",
  abandoned_reap: "Agent silent for 5 minutes",
  recovered_after_reap: "Resumed after the agent reconnected",
  task_deleted: "The task was deleted",
  task_limit: "Task limit reached",
  account_restricted: "Account restricted",
  duplicate_close: "Duplicate open session closed",
  web_on_agent_session: "Dashboard request ignored: the agent owns this timer",
  unspecified: "Not recorded (older client)",
});

export function normalizeSessionReason(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.hasOwn(SESSION_REASON_LABELS, key) ? key : "unspecified";
}

export function describeSessionReason(reason) {
  return SESSION_REASON_LABELS[normalizeSessionReason(reason)];
}

const AGENT_SOURCES = new Set(["agent", "desktop_agent"]);
const TIMER_ACTIONS = new Set(["idle", "resume", "stop", "sync"]);

/**
 * Whether a dashboard request is trying to drive a timer the agent owns.
 *
 * The agent is the timer. The dashboard used to pause it on a single "agent
 * offline" reading, stop it on sign-out, and push its own locally-ticked
 * counters over the agent's with "sync". Each of those stopped or corrupted a
 * timer the member was actively running. The dashboard no longer sends any of
 * them - but a tab already open on the old code keeps doing so until it
 * reloads, so the server refuses them regardless of what the client does.
 *
 * "start" is left alone: creating a session is governed by the one-open-session
 * rule, which already answers 409 when the agent has one running.
 */
export function isWebActionOnAgentSession({ sessionSource, requestFromWeb, action }) {
  return (
    Boolean(requestFromWeb) &&
    AGENT_SOURCES.has(String(sessionSource || "").toLowerCase()) &&
    TIMER_ACTIONS.has(action)
  );
}
