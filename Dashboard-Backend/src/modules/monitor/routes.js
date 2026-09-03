
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

const failAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000;

function isLockedOut(ip) {
  const entry = failAttempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil > Date.now()) return true;
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

function getCredentials() {
  const { monitor } = getEnv();
  return { username: monitor.username, password: monitor.password };
}

function isConfigured() {
  return getCredentials().password.length >= 8;
}

function safeCompare(a, b) {
  const la = Buffer.byteLength(a, "utf8");
  const lb = Buffer.byteLength(b, "utf8");
  const len = Math.max(la, lb, 1);
  const ba = Buffer.alloc(len, 0); Buffer.from(a, "utf8").copy(ba);
  const bb = Buffer.alloc(len, 0); Buffer.from(b, "utf8").copy(bb);
  return crypto.timingSafeEqual(ba, bb) && la === lb;
}

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

export async function routeMonitor(req, res, url) {
  const path = url.pathname;

  if (!path.startsWith("/monitor") && path !== "/monitor") return false;

  const ip = getIp(req);

  if (path === "/monitor" || path === "/monitor/") {
    const token = readSessionToken(req);
    if (token && validateSession(token)) {
      redirect(res, "/monitor/dashboard");
    } else {
      redirect(res, "/monitor/login");
    }
    return true;
  }

  if (path === "/monitor/login" && req.method === "GET") {
    const token = readSessionToken(req);
    if (token && validateSession(token)) {
      redirect(res, "/monitor/dashboard");
      return true;
    }
    html(res, getLoginHtml());
    return true;
  }

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

    clearFailedAttempts(ip);
    const token = createSession(ip);
    recordSecurityEvent({ event: "monitor_login_ok", ip, detail: `user: ${givenUser}` });
    redirect(res, "/monitor/dashboard", { "Set-Cookie": buildSessionCookie(token) });
    return true;
  }

  if (path === "/monitor/logout") {
    const token = readSessionToken(req);
    if (token) destroySession(token);
    redirect(res, "/monitor/login", { "Set-Cookie": clearSessionCookie() });
    return true;
  }

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

  if (path === "/monitor/dashboard" && req.method === "GET") {
    html(res, getDashboardHtml());
    return true;
  }

  if (path === "/monitor/api/metrics" && req.method === "GET") {
    const snap = getMetricsSnapshot();
    json(res, { ...snap, activeSessions: activeSessionCount() });
    return true;
  }

  if (path === "/monitor/api/ping" && req.method === "GET") {
    json(res, { ok: true });
    return true;
  }

  html(res, "<h1>Not found</h1>", 404);
  return true;
}
