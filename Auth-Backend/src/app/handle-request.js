import { getDb } from "../config/firebase.js";
import { enforceApiAuthentication } from "../http/auth-middleware.js";
import { applyCors, corsHeaders } from "../http/cors.js";
import { checkRateLimit } from "../http/rate-limit.js";
import { rejectSensitiveQueryParams } from "../http/password-request-guard.js";
import { assertSecureTransport } from "../http/tls-enforcement.js";
import { getSecurityHeaders } from "../http/security-headers.js";
import { routeAuth } from "../modules/auth/routes.js";
import { routeMemberInvites } from "../modules/members/routes/member-invites.routes.js";
import { routeMemberOnboarding } from "../modules/member-onboarding/routes.js";

export async function handleRequest(req, res) {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...corsHeaders(origin), ...getSecurityHeaders(req) });
    res.end();
    return;
  }

  const insecureTransport = assertSecureTransport(req);
  if (insecureTransport) {
    res.writeHead(insecureTransport.status, {
      "Content-Type": "application/json; charset=utf-8",
      ...getSecurityHeaders(req),
    });
    res.end(JSON.stringify({ success: false, error: insecureTransport.error }));
    return;
  }

  let url;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain", ...getSecurityHeaders(req) });
    res.end("Bad request");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const sensitiveQueryError = rejectSensitiveQueryParams(url);
    if (sensitiveQueryError) {
      applyCors(res, origin);
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end(JSON.stringify({ success: false, error: sensitiveQueryError }));
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    applyCors(res, origin);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
    res.end(JSON.stringify({ ok: true, service: "auth-backend" }));
    return;
  }

  if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/v1/auth/")) {
    const rateLimited = await checkRateLimit(req, url);
    if (rateLimited) {
      applyCors(res, origin);
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(rateLimited.retryAfterSec),
        ...corsHeaders(origin),
      });
      res.end(
        JSON.stringify({
          success: false,
          error: "Too many requests. Please try again later.",
        }),
      );
      return;
    }
    if (await routeAuth(req, res, url, origin)) return;
    applyCors(res, origin);
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
    res.end(JSON.stringify({ success: false, error: "Not found" }));
    return;
  }

  const db = getDb();
  if (!db && url.pathname.startsWith("/api/")) {
    applyCors(res, origin);
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
    res.end(JSON.stringify({ success: false, error: "Firestore is not configured" }));
    return;
  }

  if (url.pathname.startsWith("/api/") && db) {
    const rateLimited = await checkRateLimit(req, url);
    if (rateLimited) {
      applyCors(res, origin);
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(rateLimited.retryAfterSec),
        ...corsHeaders(origin),
      });
      res.end(
        JSON.stringify({
          success: false,
          error: "Too many requests. Please try again later.",
        }),
      );
      return;
    }

    const authGate = await enforceApiAuthentication(req, url, db);
    if (!authGate.allowed) {
      applyCors(res, origin);
      res.writeHead(authGate.status, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(origin),
      });
      res.end(JSON.stringify({ success: false, error: authGate.error, code: authGate.code }));
      return;
    }

    if (await routeMemberInvites(req, res, url, origin)) return;
    if (await routeMemberOnboarding(req, res, url, origin)) return;
  }

  applyCors(res, origin);
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  res.end(JSON.stringify({ success: false, error: "Not found" }));
}
