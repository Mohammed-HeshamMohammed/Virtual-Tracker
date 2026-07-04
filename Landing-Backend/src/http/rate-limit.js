/** In-memory rate limiter (per IP + route). Fine for dev / single instance. */

const buckets = new Map();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 60;
// Contact form is the only write path here — keep it tight against spam.
const CONTACT_LIMIT = 5;
// Session-status is checked on effectively every landing page load.
const SESSION_LIMIT = 120;

/**
 * @param {URL} url
 */
function limitBucket(url) {
  if (url.pathname === "/api/contact") return "contact";
  if (url.pathname === "/api/session-status" || url.pathname === "/api/session-logout") return "session";
  return "api";
}

/**
 * @param {URL} url
 */
function limitForBucket(url) {
  const bucket = limitBucket(url);
  if (bucket === "contact") return CONTACT_LIMIT;
  if (bucket === "session") return SESSION_LIMIT;
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

/** Skip rate limits for loopback. */
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
