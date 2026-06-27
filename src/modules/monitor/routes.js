/**
 * /monitor route handler — secure admin monitoring dashboard.
 *
 * Endpoints:
 *   GET  /monitor          → redirect to /monitor/login or /monitor/dashboard
 *   GET  /monitor/login    → login page
 *   POST /monitor/login    → authenticate & create session
 *   GET  /monitor/logout   → destroy session & redirect to login
 *   GET  /monitor/dashboard → monitoring dashboard (requires session)
 *   GET  /monitor/api/metrics → JSON metrics (requires session)
 *   GET  /monitor/api/ping    → touch session / keep-alive (requires session)
 *
 * Credentials are set via env vars:
 *   MONITOR_USERNAME  (default: "admin")
 *   MONITOR_PASSWORD  (required — server refuses to expose dashboard if not set in prod)
 */

import crypto from "node:crypto";
import { getEnv } from "../../config/env.js";
import {
  createSession,
  validateSession,
  destroySession,
  readSessionToken,
  buildSessionCookie,
  clearSessionCookie,
  activeSessionCount,
} from "./session-store.js";
import { getMetricsSnapshot, recordSecurityEvent } from "../../core/metrics.js";
import { getLoginHtml } from "./login.html.js";
import { getDashboardHtml } from "./dashboard.html.js";

// ── Brute-force protection ─────────────────────────────────────────────────────
/** @type {Map<string, { count: number, lockedUntil: number }>} */
const failAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes

function isLockedOut(ip) {
  const entry = failAttempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil > Date.now()) return true;
  // Expired lockout — reset
  failAttempts.delete(ip);
  return false;
}

function recordFailedAttempt(ip) {
  const entry = failAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    recordSecurityEvent({ event: "monitor_lockout", ip, detail: `${entry.count} failed login attempts` });
  }
  failAttempts.set(ip, entry);
}

function clearFailedAttempts(ip) {
  failAttempts.delete(ip);
}

// ── Credential resolution ──────────────────────────────────────────────────────
function getCredentials() {
  const { monitor } = getEnv();
  return { username: monitor.username, password: monitor.password };
}

function isConfigured() {
  return getCredentials().password.length >= 8;
}

/** Constant-time string comparison to prevent timing attacks. */
function safeCompare(a, b) {
  // Pad both to the same length so timingSafeEqual doesn't throw
  const la = Buffer.byteLength(a, "utf8");
  const lb = Buffer.byteLength(b, "utf8");
  const len = Math.max(la, lb, 1);
  const ba = Buffer.alloc(len, 0); Buffer.from(a, "utf8").copy(ba);
  const bb = Buffer.alloc(len, 0); Buffer.from(b, "utf8").copy(bb);
  return crypto.timingSafeEqual(ba, bb) && la === lb;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

function html(res, content, status = 200, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...extraHeaders });
  res.end(content);
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function getIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// ── Main Route Handler ─────────────────────────────────────────────────────────
/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @returns {Promise<boolean>} true if handled
 */
export async function routeMonitor(req, res, url) {
  const path = url.pathname;

  // Only handle /monitor paths
  if (!path.startsWith("/monitor") && path !== "/monitor") return false;

  const ip = getIp(req);

  // ── GET /monitor → redirect ────────────────────────────────────────────────
  if (path === "/monitor" || path === "/monitor/") {
    const token = readSessionToken(req);
    if (token && validateSession(token)) {
      redirect(res, "/monitor/dashboard");
    } else {
      redirect(res, "/monitor/login");
    }
    return true;
  }

  // ── GET /monitor/login ─────────────────────────────────────────────────────
  if (path === "/monitor/login" && req.method === "GET") {
    const token = readSessionToken(req);
    if (token && validateSession(token)) {
      redirect(res, "/monitor/dashboard");
      return true;
    }
    html(res, getLoginHtml());
    return true;
  }

  // ── POST /monitor/login ────────────────────────────────────────────────────
  if (path === "/monitor/login" && req.method === "POST") {
    if (isLockedOut(ip)) {
      recordSecurityEvent({ event: "monitor_locked_attempt", ip, detail: "Request during lockout period" });
      html(res, getLoginHtml("Too many failed attempts. Access locked for 15 minutes."), 429);
      return true;
    }

    if (!isConfigured()) {
      html(res, getLoginHtml("Monitor is not configured. Set MONITOR_PASSWORD (min 8 chars) in Backend/.env to enable access."), 503);
      return true;
    }

    let body;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (ct.includes("application/json")) {
        body = JSON.parse(raw || "{}");
      } else {
        // x-www-form-urlencoded (HTML form default)
        const params = new URLSearchParams(raw);
        body = { username: params.get("username") || "", password: params.get("password") || "" };
      }
    } catch {
      body = {};
    }

    const { username: correctUser, password: correctPass } = getCredentials();
    const givenUser = String(body?.username || "").trim();
    const givenPass = String(body?.password || "").trim();

    const userOk = safeCompare(givenUser, correctUser);
    const passOk = safeCompare(givenPass, correctPass);

    if (!userOk || !passOk) {
      recordFailedAttempt(ip);
      recordSecurityEvent({ event: "monitor_login_fail", ip, detail: `username: ${givenUser}` });
      const entry = failAttempts.get(ip);
      const remaining = entry ? MAX_ATTEMPTS - entry.count : MAX_ATTEMPTS;
      const msg = remaining > 0
        ? `Invalid credentials. ${remaining} attempt(s) remaining.`
        : `Too many failed attempts. Access locked for 15 minutes.`;
      html(res, getLoginHtml(msg), 401);
      return true;
    }

    // Valid credentials
    clearFailedAttempts(ip);
    const token = createSession(ip);
    recordSecurityEvent({ event: "monitor_login_ok", ip, detail: `user: ${givenUser}` });
    redirect(res, "/monitor/dashboard", { "Set-Cookie": buildSessionCookie(token) });
    return true;
  }

  // ── GET /monitor/logout ────────────────────────────────────────────────────
  if (path === "/monitor/logout") {
    const token = readSessionToken(req);
    if (token) destroySession(token);
    redirect(res, "/monitor/login", { "Set-Cookie": clearSessionCookie() });
    return true;
  }

  // ── AUTH GUARD for remaining routes ───────────────────────────────────────
  const token = readSessionToken(req);
  if (!token || !validateSession(token)) {
    const isApi = path.startsWith("/monitor/api");
    if (isApi) {
      json(res, { success: false, error: "Unauthorized" }, 401);
    } else {
      redirect(res, "/monitor/login");
    }
    return true;
  }

  // ── GET /monitor/dashboard ────────────────────────────────────────────────
  if (path === "/monitor/dashboard" && req.method === "GET") {
    html(res, getDashboardHtml());
    return true;
  }

  // ── GET /monitor/api/metrics ──────────────────────────────────────────────
  if (path === "/monitor/api/metrics" && req.method === "GET") {
    const snap = getMetricsSnapshot();
    json(res, { ...snap, activeSessions: activeSessionCount() });
    return true;
  }

  // ── GET /monitor/api/ping ─────────────────────────────────────────────────
  if (path === "/monitor/api/ping" && req.method === "GET") {
    json(res, { ok: true });
    return true;
  }

  // ── Unhandled /monitor/* ──────────────────────────────────────────────────
  html(res, "<h1>Not found</h1>", 404);
  return true;
}
