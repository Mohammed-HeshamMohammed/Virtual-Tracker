/**
 * Secure session store for the /monitor dashboard.
 * Sessions are in-memory only — they vanish when the server restarts or the browser closes.
 * Idle timeout: 15 minutes. Absolute TTL: 8 hours.
 */

import crypto from "node:crypto";

const IDLE_TTL_MS = 15 * 60 * 1000;   // 15 minutes idle
const ABS_TTL_MS  = 8 * 60 * 60 * 1000; // 8 hours absolute

/** @type {Map<string, { createdAt: number, lastSeen: number, ip: string }>} */
const sessions = new Map();

/** Prune expired sessions (called on each request). */
function prune() {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (now - sess.lastSeen > IDLE_TTL_MS || now - sess.createdAt > ABS_TTL_MS) {
      sessions.delete(id);
    }
  }
}

/** Create a new session and return its token. */
export function createSession(ip) {
  prune();
  const id = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  sessions.set(id, { createdAt: now, lastSeen: now, ip });
  return id;
}

/**
 * Validate a session token.
 * Returns true if valid and refreshes the idle timer.
 * @param {string} token
 * @returns {boolean}
 */
export function validateSession(token) {
  prune();
  if (!token) return false;
  const sess = sessions.get(token);
  if (!sess) return false;
  sess.lastSeen = Date.now();
  return true;
}

/** Destroy a session (logout). */
export function destroySession(token) {
  sessions.delete(token);
}

/** Read the session token from cookie header. */
export function readSessionToken(req) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "vt_monitor_sid") return decodeURIComponent(v || "");
  }
  return null;
}

/** Build a Set-Cookie header that binds the token to the browser session (no Expires → session cookie). */
export function buildSessionCookie(token) {
  return `vt_monitor_sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/monitor`;
}

/** Build a cookie header that clears the session cookie. */
export function clearSessionCookie() {
  return `vt_monitor_sid=; HttpOnly; SameSite=Strict; Path=/monitor; Max-Age=0`;
}

/** Return count of active sessions (for dashboard). */
export function activeSessionCount() {
  prune();
  return sessions.size;
}
