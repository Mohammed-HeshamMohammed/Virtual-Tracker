import { getRedisClient } from "../../lib/redis/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

const RECORD_TTL_SECONDS = 600;
const ONLINE_SET_KEY = "presence:online";
/** @type {boolean} */
let loggedWriteFailure = false;

function recordKey(userId) {
  return `presence:${userId}`;
}

function logWriteFailureOnce(err) {
  if (loggedWriteFailure) return;
  loggedWriteFailure = true;
  logSafeWarn("[presence/redis] write failed — check REDIS_URL is reachable:", err);
}

/**
 * Redis-backed presence persistence — shared live layer across instances
 * when REDIS_URL is set. Records carry a TTL as a crash safety net (in place
 * of RTDB's onDisconnect): if a process dies without cleaning up, the key
 * expires on its own instead of leaving a permanent "online" ghost.
 */
export function createRedisPresenceStore() {
  /**
   * @param {import("./presence-events.js").PresenceRecord} record
   */
  async function set(record) {
    if (!record?.userId) return false;
    const redis = getRedisClient();
    if (!redis) return false;
    try {
      await redis.set(recordKey(record.userId), JSON.stringify(record), "EX", RECORD_TTL_SECONDS);
      if (record.status === "online" || record.status === "idle") {
        await redis.zadd(ONLINE_SET_KEY, Date.now() + RECORD_TTL_SECONDS * 1000, record.userId);
      } else {
        await redis.zrem(ONLINE_SET_KEY, record.userId);
      }
      return true;
    } catch (err) {
      logWriteFailureOnce(err);
      return false;
    }
  }

  /**
   * @param {string} userId
   * @returns {Promise<import("./presence-events.js").PresenceRecord | null>}
   */
  async function get(userId) {
    if (!userId) return null;
    const redis = getRedisClient();
    if (!redis) return null;
    try {
      const raw = await redis.get(recordKey(userId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string[]} userIds
   * @returns {Promise<Map<string, import("./presence-events.js").PresenceRecord | null>>}
   */
  async function getMany(userIds) {
    const out = new Map();
    if (!userIds.length) return out;
    const redis = getRedisClient();
    if (!redis) {
      for (const id of userIds) out.set(id, null);
      return out;
    }
    try {
      const values = await redis.mget(userIds.map(recordKey));
      userIds.forEach((id, index) => {
        const raw = values[index];
        out.set(id, raw ? JSON.parse(raw) : null);
      });
    } catch {
      for (const id of userIds) out.set(id, null);
    }
    return out;
  }

  /**
   * @param {string} userId
   */
  async function deleteUser(userId) {
    if (!userId) return;
    const redis = getRedisClient();
    if (!redis) return;
    try {
      await redis.del(recordKey(userId));
      await redis.zrem(ONLINE_SET_KEY, userId);
    } catch {
      /* ignore */
    }
  }

  /**
   * @returns {Promise<string[]>}
   */
  async function listOnlineUserIds() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
      const now = Date.now();
      await redis.zremrangebyscore(ONLINE_SET_KEY, "-inf", now);
      return await redis.zrangebyscore(ONLINE_SET_KEY, now, "+inf");
    } catch {
      return [];
    }
  }

  return { set, get, getMany, delete: deleteUser, listOnlineUserIds };
}
