import { logSafeWarn } from "./sanitize-error.js";
import { getReadyRedisClient } from "../lib/redis/client.js";

const WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 30 * 60_000;
const MAX_FAILURES = 5;

const buckets = new Map();

function pruneOld(failures, now) {
  return failures.filter((ts) => now - ts < WINDOW_MS);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

// One normalisation for every read, write and clear. Clearing used the raw key while
// counting used the lowercased one, so a success never cleared an email typed with
// capitals or spaces - its failures kept counting toward a lockout.
function keysFor(req, email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return [normalized ? `email:${normalized}` : null, `ip:${clientIp(req).toLowerCase()}`].filter(Boolean);
}

function getBucket(key) {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { failures: [], lockedUntil: 0 };
    buckets.set(key, bucket);
  }
  return bucket;
}

const LOCKED = (retryAfterSeconds) => ({
  allowed: false,
  retryAfterSeconds,
  message: "Too many failed registration attempts. Please try again later.",
});

// Redis, when it is connected, so every backend instance enforces one lockout and a
// deploy does not lift it. The failure count runs in a fixed 15-minute window from the
// first failure (the in-memory fallback slides); a lockout is a key that expires.
const failKey = (key) => `invite-abuse:fail:${key}`;
const lockKey = (key) => `invite-abuse:lock:${key}`;

async function withRedis(fn, fallback) {
  const redis = getReadyRedisClient();
  if (redis) {
    try {
      return await fn(redis);
    } catch (err) {
      logSafeWarn("[invite-abuse-guard] Redis failed; using memory for this request", err);
    }
  }
  return fallback();
}

export async function checkInviteRegisterAllowed(req, email) {
  const keys = keysFor(req, email);
  return withRedis(
    async (redis) => {
      for (const key of keys) {
        const ttlMs = await redis.pttl(lockKey(key));
        if (ttlMs > 0) return LOCKED(Math.ceil(ttlMs / 1000));
      }
      return { allowed: true };
    },
    () => {
      const now = Date.now();
      for (const key of keys) {
        const bucket = getBucket(key);
        bucket.failures = pruneOld(bucket.failures, now);
        if (bucket.lockedUntil > now) return LOCKED(Math.ceil((bucket.lockedUntil - now) / 1000));
      }
      return { allowed: true };
    },
  );
}

export async function recordInviteRegisterFailure(req, email) {
  const keys = keysFor(req, email);
  await withRedis(
    async (redis) => {
      for (const key of keys) {
        const results = await redis.multi().set(failKey(key), 0, "PX", WINDOW_MS, "NX").incr(failKey(key)).exec();
        const failed = results.find(([err]) => err);
        if (failed) throw failed[0];
        if (Number(results[1][1]) >= MAX_FAILURES) {
          await redis.multi().set(lockKey(key), 1, "PX", LOCKOUT_MS).del(failKey(key)).exec();
        }
      }
    },
    () => {
      const now = Date.now();
      for (const key of keys) {
        const bucket = getBucket(key);
        bucket.failures = pruneOld(bucket.failures, now);
        bucket.failures.push(now);
        if (bucket.failures.length >= MAX_FAILURES) {
          bucket.lockedUntil = now + LOCKOUT_MS;
          bucket.failures = [];
        }
      }
    },
  );
}

export async function recordInviteRegisterSuccess(req, email) {
  const keys = keysFor(req, email);
  await withRedis(
    async (redis) => {
      await redis.del(...keys.flatMap((key) => [failKey(key), lockKey(key)]));
    },
    () => {
      for (const key of keys) buckets.delete(key);
    },
  );
}
