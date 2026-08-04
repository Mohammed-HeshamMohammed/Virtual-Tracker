import { getRedisClient } from "../../lib/redis/client.js";
import { updatePgSession } from "../../lib/postgres/activity-events-postgres.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordSecurityEvent } from "../../core/metrics.js";

const HEARTBEAT_TTL_SEC = 15;

// How stale activity_sessions.updated_at must be before a session is treated
// as abandoned. The agent syncs every SESSION_SYNC_INTERVAL_SEC (20s), so
// this is ~4 missed syncs - generous on purpose. This is the correctness
// signal (TC-1): it is durable, needs no second store, and - unlike the Redis
// heartbeat below - cannot report "abandoned" just because a cache restarted.
// A Redis outage or unset REDIS_URL used to close every active agent session
// within 5s (the agent's own poll interval); this makes that impossible.
const SESSION_STALE_MS = 90_000;

function key(memberId) {
  return `agent:heartbeat:${memberId}`;
}

/** Called whenever the desktop agent's own client hits the backend (no browser Origin). */
export async function touchAgentHeartbeat(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return;
  try {
    await redis.set(key(memberId), "1", "EX", HEARTBEAT_TTL_SEC);
  } catch {
    // Best-effort — a missed heartbeat write just means one status check reads stale.
  }
}

/**
 * True if the desktop agent has pinged the backend within the last
 * HEARTBEAT_TTL_SEC. Presence/UI signal only - NOT used to decide whether a
 * session is abandoned (see isSessionAbandoned). A false "offline" here is
 * cosmetic; it must never be destructive.
 */
export async function isAgentOnline(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return false;
  try {
    return (await redis.exists(key(memberId))) === 1;
  } catch {
    return false;
  }
}

/**
 * True if `session` (an open activity_sessions row) was started by the
 * desktop agent, is still marked active/idle, and hasn't synced in
 * SESSION_STALE_MS - i.e. it was left open by a crash/kill with no clean
 * stop. Deliberately does not consult Redis: an unreachable/unconfigured
 * cache is "we don't know", not "the agent is gone", and must not be read as
 * evidence that an employee stopped working.
 * @param {{ source?: string, status?: string, member_id?: string, updated_at?: unknown }} session
 */
export async function isSessionAbandoned(session) {
  if (!session) return false;
  const status = String(session.status || "").toLowerCase();
  if (session.source !== "agent" || (status !== "active" && status !== "idle")) return false;
  if (session.updated_at == null) return false; // unknown -> fail open, same as Redis-unknown
  const updatedAt = new Date(session.updated_at).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > SESSION_STALE_MS;
}

/**
 * Closes an abandoned desktop-agent session server-side, keeping whatever
 * active_seconds/idle_seconds it last synced instead of losing them.
 * @param {{ id: string, member_id?: string }} session
 */
export async function closeAbandonedSession(session) {
  const now = new Date();
  await updatePgSession(session.id, { status: "stopped", endedAt: now, updatedAt: now });
  logSafeWarn("[agent-heartbeat] closed abandoned desktop-agent session", {
    sessionId: session.id,
    memberId: session.member_id,
  });
  // OBS-3: "alert on abandoned-session closures per minute... under TC-1's
  // fix this is near-zero in normal operation, so a spike is a real
  // incident." Same /monitor security-event feed as OBS-2 - one place an
  // operator already looks, not a second dashboard.
  recordSecurityEvent({
    event: "abandoned_session_closed",
    detail: `session=${session.id} member=${session.member_id ?? "unknown"}`,
  });
}
