/** In-memory rate limiter (per IP + route). Fine for dev / single instance. */

const buckets = new Map();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
// Eased again — the auth bucket is shared by every /api/auth/* route at
// once (resolve-sign-in-methods, sign-in, password reset, the desktop
// agent's link-flow polling, Google OAuth...), so several people signing
// in around the same time behind one office/shared NAT IP were adding up
// against a single 60/min bucket meant for one person. Same reasoning as
// the raise before this one, just tuned further: this is a per-IP abuse
// backstop, not meant to be the thing a legitimate login run into.
const AUTH_LIMIT = 120;
// validate-password fires on password-strength checks while typing during
// sign-up/reset (already debounced + deduped client-side - see
// use-password-backend-check.ts) - several people typing passwords behind
// the same shared IP around the same time was enough to trip 40/min.
const VALIDATE_PASSWORD_LIMIT = 80;
// Invite acceptance is a login-adjacent flow (a new teammate landing on
// their invite link) - 15/min was tight enough that a couple of people
// accepting invites from the same office IP within a minute could trip it.
const PUBLIC_INVITE_LIMIT = 30;
const PRESENCE_LIMIT = 30;
const ACTIVITY_LIMIT = 60;
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
