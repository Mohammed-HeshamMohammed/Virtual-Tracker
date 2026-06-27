import { getDb } from "./core/database/firebase.js";
import { applyCors, corsHeaders } from "./core/middleware/security/cors.js";
import { checkRateLimit } from "./core/middleware/security/rate-limit.js";
import { rejectSensitiveQueryParams } from "./core/middleware/security/password-request-guard.js";
import { assertSecureTransport } from "./core/middleware/security/tls-enforcement.js";
import { getSecurityHeaders } from "./core/middleware/security/security-headers.js";
import { routeAuth } from "./modules/auth/routes.js";
import { routeInvites } from "./modules/invites/routes.js";

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
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...getSecurityHeaders(req),
    });
    res.end(JSON.stringify({ ok: true }));
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
    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...getSecurityHeaders(req),
    });
    res.end(JSON.stringify({ success: false, error: "Not found" }));
    return;
  }

  const db = getDb();
  if (!db && url.pathname.startsWith("/api/")) {
    applyCors(res, origin);
    res.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...getSecurityHeaders(req),
    });
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

    const { enforceApiAuthentication } = await import("./core/middleware/auth/auth-middleware.js");
    const authGate = await enforceApiAuthentication(req, url, db);
    if (!authGate.allowed) {
      applyCors(res, origin);
      res.writeHead(authGate.status, {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(origin),
        ...getSecurityHeaders(req),
      });
      res.end(JSON.stringify({ success: false, error: authGate.error, code: authGate.code }));
      return;
    }

    if (await routeInvites(req, res, url, origin)) return;
  }

  // Reject all other endpoints cleanly with a 404
  applyCors(res, origin);
  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin),
    ...getSecurityHeaders(req),
  });
  res.end(JSON.stringify({ success: false, error: "Not found" }));
}
