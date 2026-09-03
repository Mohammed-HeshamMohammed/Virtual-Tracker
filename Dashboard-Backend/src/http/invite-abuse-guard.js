
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

function getBucket(key) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return { failures: [], lockedUntil: 0 };
  let bucket = buckets.get(normalized);
  if (!bucket) {
    bucket = { failures: [], lockedUntil: 0 };
    buckets.set(normalized, bucket);
  }
  return bucket;
}

export function checkInviteRegisterAllowed(req, email) {
  const now = Date.now();
  const keys = [`email:${email}`, `ip:${clientIp(req)}`];
  for (const key of keys) {
    const bucket = getBucket(key);
    bucket.failures = pruneOld(bucket.failures, now);
    if (bucket.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((bucket.lockedUntil - now) / 1000);
      return {
        allowed: false,
        retryAfterSeconds,
        message: "Too many failed registration attempts. Please try again later.",
      };
    }
  }
  return { allowed: true };
}

export function recordInviteRegisterFailure(req, email) {
  const now = Date.now();
  const keys = [`email:${email}`, `ip:${clientIp(req)}`];
  for (const key of keys) {
    const bucket = getBucket(key);
    bucket.failures = pruneOld(bucket.failures, now);
    bucket.failures.push(now);
    if (bucket.failures.length >= MAX_FAILURES) {
      bucket.lockedUntil = now + LOCKOUT_MS;
      bucket.failures = [];
    }
  }
}

export function recordInviteRegisterSuccess(req, email) {
  const keys = [`email:${email}`, `ip:${clientIp(req)}`];
  for (const key of keys) {
    buckets.delete(key);
  }
}
