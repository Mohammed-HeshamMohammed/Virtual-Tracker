import { applyCors, corsHeaders } from "./core/middleware/security/cors.js";
import { assertSecureTransport } from "./core/middleware/security/tls-enforcement.js";
import { getSecurityHeaders } from "./core/middleware/security/security-headers.js";
import { rejectSensitiveQueryParams } from "./core/middleware/security/password-request-guard.js";

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

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    applyCors(res, origin);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...getSecurityHeaders(req),
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  applyCors(res, origin);
  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin),
    ...getSecurityHeaders(req),
  });
  res.end(JSON.stringify({ success: false, error: "Not found" }));
}
