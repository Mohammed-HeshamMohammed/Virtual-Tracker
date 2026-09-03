
import crypto from "node:crypto";

const IDLE_TTL_MS = 15 * 60 * 1000;
const ABS_TTL_MS  = 8 * 60 * 60 * 1000;

const sessions = new Map();

function prune() {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (now - sess.lastSeen > IDLE_TTL_MS || now - sess.createdAt > ABS_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function createSession(ip) {
  prune();
  const id = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  sessions.set(id, { createdAt: now, lastSeen: now, ip });
  return id;
}

export function validateSession(token) {
  prune();
  if (!token) return false;
  const sess = sessions.get(token);
  if (!sess) return false;
  sess.lastSeen = Date.now();
  return true;
}

export function destroySession(token) {
  sessions.delete(token);
}

export function readSessionToken(req) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "vt_monitor_sid") return decodeURIComponent(v || "");
  }
  return null;
}

export function buildSessionCookie(token) {
  return `vt_monitor_sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/monitor`;
}

export function clearSessionCookie() {
  return `vt_monitor_sid=; HttpOnly; SameSite=Strict; Path=/monitor; Max-Age=0`;
}

export function activeSessionCount() {
  prune();
  return sessions.size;
}
