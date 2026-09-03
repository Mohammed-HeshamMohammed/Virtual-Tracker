import { getRedisClient } from "../../lib/redis/client.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

const RECORD_TTL_SECONDS = 600;
const ONLINE_SET_KEY = "presence:online";
let loggedWriteFailure = false;

function recordKey(userId) {
  return `presence:${userId}`;
}

function logWriteFailureOnce(err) {
  if (loggedWriteFailure) return;
  loggedWriteFailure = true;
  logSafeWarn("[presence/redis] write failed — check REDIS_URL is reachable:", err);
}

export function createRedisPresenceStore() {
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
