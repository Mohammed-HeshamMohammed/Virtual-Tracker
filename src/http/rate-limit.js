/** In-memory rate limiter (per IP + route). Fine for dev / single instance. */

const buckets = new Map();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
// One IP/NAT can host several legitimate concurrent sessions (2 browsers, a phone,
// a housemate) — each sign-in plus periodic session-role sync easily adds up to a
// handful of requests per session, so 25/min was tight enough to false-positive.
const AUTH_LIMIT = 60;
const VALIDATE_PASSWORD_LIMIT = 40;
const PUBLIC_INVITE_LIMIT = 15;
const PRESENCE_LIMIT = 30;
// Shared per-IP across scope+feed+agent/status: several teammates behind one office
// NAT, or a few browser tabs, all draw from the same bucket, plus the dashboard's
// own burst refetches (toggling project scope, closing the add-member modal) can
// spend 5-10 requests in under a second. 60/min was tight enough to false-positive
// on normal use, not just abuse.
const ACTIVITY_LIMIT = 240;
const SEARCH_LIMIT = 40;

/**
 * @param {URL} url
 */
function limitBucket(url) {
  const path = url.pathname.replace(/^\/api\/v1/, "/api");
  if (path === "/api/auth/presence") return "presence";
  if (path === "/api/auth/validate-password") return "validate-password";
  if (path.startsWith("/api/auth/")) return "auth";
  if (path.startsWith("/api/public/invites/")) return "public-invite";
  if (path.startsWith("/api/activity/")) return "activity";
  if (path.includes("/search") || url.searchParams.has("q") || url.searchParams.has("query")) {
    return "search";
  }
  return "api";
}

/**
 * @param {URL} url
 */
function limitForBucket(url) {
  const bucket = limitBucket(url);
  if (bucket === "validate-password") return VALIDATE_PASSWORD_LIMIT;
  if (bucket === "auth") return AUTH_LIMIT;
  if (bucket === "public-invite") return PUBLIC_INVITE_LIMIT;
  if (bucket === "presence") return PRESENCE_LIMIT;
  if (bucket === "activity") return ACTIVITY_LIMIT;
  if (bucket === "search") return SEARCH_LIMIT;
  return DEFAULT_LIMIT;
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Local launcher / Next dev server — do not throttle loopback traffic.
 * @param {import("node:http").IncomingMessage} req
 */
function isLocalClient(req) {
  const addr = clientKey(req);
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "unknown" ||
    addr.startsWith("::ffff:127.0.0.1")
  );
}

/**
 * @param {string} key
 * @param {number} limit
 */
function checkMemoryLimit(key, limit) {
  const now = Date.now();
  const entry = buckets.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };

  if (now >= entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }

  entry.count += 1;
  buckets.set(key, entry);

  if (entry.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { status: 429, retryAfterSec };
  }

  return null;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} url
 * @returns {Promise<{ status: 429, retryAfterSec: number } | null>}
 */
export async function checkRateLimit(req, url) {
  if (isLocalClient(req)) {
    return null;
  }

  const bucket = limitBucket(url);
  const limit = limitForBucket(url);
  const key = `${clientKey(req)}:${bucket}`;
  return checkMemoryLimit(key, limit);
}
