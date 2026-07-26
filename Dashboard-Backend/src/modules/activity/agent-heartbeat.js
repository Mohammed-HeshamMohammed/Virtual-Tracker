import { getRedisClient } from "../../lib/redis/client.js";
import { updatePgSession } from "../../lib/postgres/activity-events-postgres.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

const HEARTBEAT_TTL_SEC = 15;

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

/** True if the desktop agent has pinged the backend within the last HEARTBEAT_TTL_SEC. */
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
 * desktop agent, is still marked active/idle, and that agent hasn't pinged
 * recently - i.e. it was left open by a crash/kill with no clean stop.
 * @param {{ source?: string, status?: string, member_id?: string }} session
 */
export async function isSessionAbandoned(session) {
  if (!session) return false;
  const status = String(session.status || "").toLowerCase();
  if (session.source !== "agent" || (status !== "active" && status !== "idle")) return false;
  return !(await isAgentOnline(session.member_id));
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
}
