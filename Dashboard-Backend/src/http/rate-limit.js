import { createHash } from "node:crypto";
import { readBearerToken } from "./auth-token.js";

const buckets = new Map();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const AUTH_LIMIT = 60;
const VALIDATE_PASSWORD_LIMIT = 40;
const PUBLIC_INVITE_LIMIT = 15;
const PRESENCE_LIMIT = 30;
const ACTIVITY_LIMIT = 240;
const SEARCH_LIMIT = 40;

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

function ipKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Who this request is rate-limited as: the signed-in member if we can tell
 * who that is, the caller's IP otherwise.
 *
 * A request that carries a bearer token is keyed by that token (hashed - the
 * key only needs to be stable and unguessable, not reversible) rather than
 * the IP it arrived from. Every desktop agent, and every browser tab, in the
 * same office or behind the same VPN or CGNAT otherwise shares one IP and so
 * one bucket - the "activity" bucket the agent polls every few seconds while
 * tracking, at 240 requests/min, saturates on background polling alone once
 * a handful of people are tracking from the same network, and everyone on it
 * starts seeing Start/Pause/Stop rejected with no relation to what they
 * personally did. A pre-auth request (signing in, redeeming an invite) never
 * carries a token yet, so those buckets are unaffected and still need IP
 * keying - that's what actually stops a login brute-force.
 */
function clientKey(req) {
  const token = readBearerToken(req);
  if (token) {
    return `member:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
  }
  return ipKey(req);
}

function isLocalClient(req) {
  const addr = ipKey(req);
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "unknown" ||
    addr.startsWith("::ffff:127.0.0.1")
  );
}

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

export async function checkRateLimit(req, url) {
  if (isLocalClient(req)) {
    return null;
  }

  const bucket = limitBucket(url);
  const limit = limitForBucket(url);
  const key = `${clientKey(req)}:${bucket}`;
  return checkMemoryLimit(key, limit);
}
