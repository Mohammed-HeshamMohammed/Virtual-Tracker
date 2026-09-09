import { getEnv } from "../../config/env.js";
import { corsHeaders } from "../../http/cors.js";
import { getSecurityHeaders } from "../../http/security-headers.js";
import { logSafeWarn } from "../../http/sanitize-error.js";

function sendCredentialedJson(res, req, origin, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin, { credentials: true }),
    ...getSecurityHeaders(req),
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

export async function routeSessionProxy(req, res, url, origin) {
  const dashboardUrl = getEnv().dashboard.backendUrl.replace(/\/+$/, "");

  if (url.pathname === "/api/session-status" && req.method === "GET") {
    if (!dashboardUrl) {
      sendCredentialedJson(res, req, origin, 200, { success: true, signedIn: false });
      return true;
    }
    try {
      const upstream = await fetch(`${dashboardUrl}/api/auth/session-status`, {
        headers: req.headers.cookie ? { cookie: req.headers.cookie } : {},
      });
      const body = await upstream.json().catch(() => ({ success: false, signedIn: false }));
      sendCredentialedJson(res, req, origin, upstream.ok ? 200 : upstream.status, body);
    } catch (err) {
      logSafeWarn("[session-proxy] session-status upstream call failed", err);
      sendCredentialedJson(res, req, origin, 200, { success: true, signedIn: false });
    }
    return true;
  }

  if (url.pathname === "/api/session-logout" && req.method === "POST") {
    if (!dashboardUrl) {
      sendCredentialedJson(res, req, origin, 200, { success: true });
      return true;
    }
    try {
      const upstream = await fetch(`${dashboardUrl}/api/auth/session-logout`, {
        method: "POST",
        headers: req.headers.cookie ? { cookie: req.headers.cookie } : {},
      });
      const setCookie = upstream.headers.get("set-cookie");
      const body = await upstream.json().catch(() => ({ success: true }));
      sendCredentialedJson(
        res,
        req,
        origin,
        upstream.ok ? 200 : upstream.status,
        body,
        setCookie ? { "Set-Cookie": setCookie } : {},
      );
    } catch (err) {
      logSafeWarn("[session-proxy] session-logout upstream call failed", err);
      sendCredentialedJson(res, req, origin, 200, { success: true });
    }
    return true;
  }

  return false;
}
