import { applyCors, corsHeaders } from "../http/cors.js";
import { checkRateLimit } from "../http/rate-limit.js";
import { rejectSensitiveQueryParams } from "../http/query-guard.js";
import { assertSecureTransport } from "../http/tls-enforcement.js";
import { getSecurityHeaders } from "../http/security-headers.js";
import { routeContact } from "../modules/contact/contact-routes.js";
import { routeSessionProxy } from "../modules/session/session-proxy-routes.js";
import { routeDownload } from "../modules/download/download-routes.js";
import { routeUpdateFeed } from "../modules/update/update-routes.js";

const SESSION_PROXY_PATHS = new Set(["/api/session-status", "/api/session-logout"]);

export async function handleRequest(req, res) {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    const pathname = (req.url ?? "/").split("?")[0];
    const credentials = SESSION_PROXY_PATHS.has(pathname);
    res.writeHead(204, { ...corsHeaders(origin, { credentials }), ...getSecurityHeaders(req) });
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
    res.end(JSON.stringify({ ok: true, service: "landing-backend" }));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
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
          code: "RATE_LIMITED",
          retryAfterSec: rateLimited.retryAfterSec,
        }),
      );
      return;
    }

    if (await routeUpdateFeed(req, res, url, origin)) return;
    if (await routeDownload(req, res, url, origin)) return;
    if (await routeSessionProxy(req, res, url, origin)) return;
    if (await routeContact(req, res, url, origin)) return;

    applyCors(res, origin);
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
    res.end(JSON.stringify({ success: false, error: "Not found" }));
    return;
  }

  applyCors(res, origin);
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  res.end(JSON.stringify({ success: false, error: "Not found" }));
}
