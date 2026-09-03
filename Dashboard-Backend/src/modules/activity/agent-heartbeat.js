import { getRedisClient } from "../../lib/redis/client.js";
import { updatePgSession } from "../../lib/postgres/activity-events-postgres.service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { recordSecurityEvent } from "../../core/metrics.js";

const HEARTBEAT_TTL_SEC = 15;

const SESSION_STALE_MS = 5 * 60_000;

function key(memberId) {
  return `agent:heartbeat:${memberId}`;
}

export async function touchAgentHeartbeat(memberId) {
  const redis = getRedisClient();
  if (!redis || !memberId) return;
  try {
    await redis.set(key(memberId), "1", "EX", HEARTBEAT_TTL_SEC);
  } catch {
    // Best-effort — a missed heartbeat write just means one status check reads stale.
  }
}

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
  await updatePgSession(session.id, { status: "stopped", endedAt: now, updatedAt: now });
  logSafeWarn("[agent-heartbeat] closed abandoned desktop-agent session", {
    sessionId: session.id,
    memberId: session.member_id,
  });
  recordSecurityEvent({
    event: "abandoned_session_closed",
    detail: `session=${session.id} member=${session.member_id ?? "unknown"}`,
  });
}
