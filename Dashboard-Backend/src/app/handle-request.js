import { getDb } from "../config/firebase.js";
import { enforceApiAuthentication } from "../http/auth-middleware.js";
import { applyCors, corsHeaders } from "../http/cors.js";
import { checkRateLimit } from "../http/rate-limit.js";
import { rejectSensitiveQueryParams } from "../http/password-request-guard.js";
import { assertSecureTransport } from "../http/tls-enforcement.js";
import { getSecurityHeaders } from "../http/security-headers.js";
import { sendJson } from "../http/response.js";
import { routeMemberBans } from "../modules/members/routes/member-bans.routes.js";
import { routeMemberRemoveFromTree } from "../modules/members/routes/member-remove-from-tree.routes.js";
import { routeMemberInvites } from "../modules/members/routes/member-invites.routes.js";
import { routeMemberMigration } from "../modules/members/routes/member-migration.routes.js";
import { routeMemberRelationships } from "../modules/member-relationships/routes.js";
import { routeMemberTransferRequests } from "../modules/hierarchy/routes.js";
import { routeMemberOnboarding } from "../modules/member-onboarding/routes.js";
import { routeSchemaCrud } from "../modules/schema/routes.js";
import { routeCompatibility } from "../modules/compat/routes.js";
import { routePresenceEvents } from "../modules/presence/index.js";
import { routeActivity } from "../modules/activity/routes.js";
import { routeProjects } from "../modules/projects/routes.js";
import { routeClients } from "../modules/clients/routes.js";
import { routeMonitor } from "../modules/monitor/routes.js";
import { routeTasks } from "../modules/tasks/routes.js";
import { routeNotifications } from "../modules/notifications/routes.js";
import { routeDashboard } from "../modules/dashboard/routes.js";
import { routeBootstrap } from "../modules/bootstrap/routes.js";
import { routeAuthIdentity } from "../modules/auth/identity-routes.js";
import { isAuthnApiPath } from "../modules/auth/authn-paths.js";
import { probeFirestoreReadiness } from "../modules/auth/readiness.js";
import { isSessionCookiePath } from "../modules/auth/session-cookie.js";

export async function handleRequest(req, res) {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    const pathname = (req.url ?? "/").split("?")[0];
    const credentials = isSessionCookiePath(pathname);
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
    res.end(JSON.stringify({ ok: true, service: "dashboard-backend" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/readiness") {
    applyCors(res, origin);
    const readiness = await probeFirestoreReadiness(getDb());
    if (readiness.ok) {
      sendJson(res, origin, 200, { success: true, firestore: "ok" });
      return;
    }
    sendJson(res, origin, readiness.status, {
      success: false,
      code: readiness.code,
      error: readiness.error,
    });
    return;
  }

  if (url.pathname.startsWith("/monitor")) {
    if (await routeMonitor(req, res, url)) return;
  }

  if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/v1/auth/")) {
    if (isAuthnApiPath(url.pathname)) {
      applyCors(res, origin);
      sendJson(res, origin, 404, {
        success: false,
        error: "This route is handled by Auth-Backend.",
        code: "AUTH_BACKEND_ROUTE",
      });
      return;
    }

    const db = getDb();
    if (!db) {
      applyCors(res, origin);
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
      res.end(JSON.stringify({ success: false, error: "Firestore is not configured" }));
      return;
    }

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

    if (await routeAuthIdentity(req, res, url, origin)) return;

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
          code: "RATE_LIMITED",
          retryAfterSec: rateLimited.retryAfterSec,
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

    if (await routeMemberBans(req, res, url, origin)) return;
    if (await routeMemberRemoveFromTree(req, res, url, origin)) return;
    if (await routeMemberInvites(req, res, url, origin)) return;
    if (await routeMemberMigration(req, res, url, origin)) return;
    if (await routeMemberOnboarding(req, res, url, origin)) return;
    if (await routeMemberTransferRequests(req, res, url, origin)) return;
    if (await routeMemberRelationships(req, res, url, origin)) return;
    if (await routeActivity(req, res, url, origin)) return;
    if (await routeProjects(req, res, url, db, origin)) return;
    if (await routeDashboard(req, res, url, db, origin)) return;
    if (await routeBootstrap(req, res, url, db, origin)) return;
    if (await routeClients(req, res, url, db, origin)) return;
    if (await routeTasks(req, res, url, db, origin)) return;
    if (await routeNotifications(req, res, url, origin)) return;
    if (await routePresenceEvents(req, res, url, origin)) return;
    if (await routeCompatibility(req, res, url, db, origin)) return;
    if (await routeSchemaCrud(req, res, url, db, origin)) return;
  }

  applyCors(res, origin);
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  res.end(JSON.stringify({ success: false, error: "Not found" }));
}
