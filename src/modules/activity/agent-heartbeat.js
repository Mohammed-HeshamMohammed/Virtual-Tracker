import { getRedisClient } from "../../lib/redis/client.js";

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
