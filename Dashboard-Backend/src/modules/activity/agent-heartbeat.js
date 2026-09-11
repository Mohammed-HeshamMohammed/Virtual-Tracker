import { getRedisClient } from "../../lib/redis/client.js";
import { updatePgSession } from "../../lib/postgres/activity-events-postgres.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordSecurityEvent } from "../../core/metrics.js";

/**
 * How long one heartbeat keeps an agent reading as "online".
 *
 * This has to comfortably outlast the longest gap between the agent's writes,
 * or a healthy agent reads as offline between them. It was 15s when the agent
 * polled its session every 5s. Agent v1.0.2 moved that poll to every third tick
 * (LAG-1, to stop it holding the client lock every five seconds), so writes came
 * at least 15s apart - the key now expired before every refresh. The dashboard,
 * which checks every 5s and paused the timer on the first "offline" answer,
 * would then pause a timer whose agent was running perfectly well.
 *
 * The widest real gap: a poll every 3 ticks (~15-17s), one more tick when a poll
 * yields to the UI, and a request that takes up to the 15s HTTP timeout - about
 * 35s. Sixty leaves room. The cost is that an agent that genuinely quits keeps
 * reading as online for up to a minute; the abandoned-session sweep (5 min) is
 * what actually closes its session, so nothing depends on this being faster.
 */
export const HEARTBEAT_TTL_SEC = 60;

const SESSION_STALE_MS = 5 * 60_000;

function key(memberId) {
  return `agent:heartbeat:${memberId}`;
}

export async function touchAgentHeartbeat(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return;
  try {
    // The value is when we heard from it, so presence can report "last seen"
    // rather than a bare yes/no.
    await redis.set(key(memberId), String(Date.now()), "EX", HEARTBEAT_TTL_SEC);
  } catch {
    // Best-effort — a missed heartbeat write just means one status check reads stale.
  }
}

/**
 * Whether the member's agent is checking in - and whether we could tell.
 *
 * `isAgentOnline` below answers false both when the agent is gone and when
 * Redis cannot be asked. The dashboard read that false as "agent not running"
 * and paused the timer, so a Redis restart or outage paused every active timer
 * at once. That is the same confusion TC-1 fixed for the abandoned-session
 * sweep, left alive on the dashboard's path. "unknown" is its own answer here:
 * nothing may pause, stop or warn on it.
 *
 * @returns {{ presence: "online" | "offline" | "unknown", lastSeenAt: string | null }}
 */
export async function getAgentPresence(memberId) {
  if (!memberId) return { presence: "offline", lastSeenAt: null };
  let redis = null;
  try {
    redis = getRedisClient();
  } catch {
    redis = null;
  }
  if (!redis) return { presence: "unknown", lastSeenAt: null };
  try {
    const value = await redis.get(key(memberId));
    if (value == null) return { presence: "offline", lastSeenAt: null };
    const ms = Number(value);
    return {
      presence: "online",
      lastSeenAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    };
  } catch {
    return { presence: "unknown", lastSeenAt: null };
  }
}

/** Kept for existing callers; prefer getAgentPresence, which can say "unknown". */
export async function isAgentOnline(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return false;
  try {
    return (await redis.exists(key(memberId))) === 1;
  } catch {
    return false;
  }
}

export async function isSessionAbandoned(session) {
  if (!session) return false;
  const status = String(session.status || "").toLowerCase();
  if (session.source !== "agent" || (status !== "active" && status !== "idle")) return false;
  if (session.updated_at == null) return false;
  const updatedAt = new Date(session.updated_at).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > SESSION_STALE_MS;
}

export async function closeAbandonedSession(session) {
  const now = new Date();
  await updatePgSession(session.id, {
    status: "stopped",
    endedAt: now,
    updatedAt: now,
    stopReason: "abandoned_reap",
    event: { action: "stop", reason: "abandoned_reap", source: "server" },
  });
  logSafeWarn("[agent-heartbeat] closed abandoned desktop-agent session", {
    sessionId: session.id,
    memberId: session.member_id,
  });
  recordSecurityEvent({
    event: "abandoned_session_closed",
    detail: `session=${session.id} member=${session.member_id ?? "unknown"}`,
  });
}
