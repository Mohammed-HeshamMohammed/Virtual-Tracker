import { getEnv } from "../config/env.js";
import { logRequest, logResponse } from "../core/logger.js";
import { sendJson } from "../http/response.js";
import { routeEmail } from "../modules/email/routes.js";
import { routePhone } from "../modules/phone/routes.js";
import { routePush } from "../modules/push/routes.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function resolveAllowedOrigin(reqOrigin) {
  const env = getEnv();
  const raw = env.cors.corsOrigins || env.cors.frontendOrigin || "";
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) {
    // Nothing configured. Reflecting the caller's origin back is convenient
    // in development and fail-open in production - the same shape as the TLS
    // bug fixed in a1bf554, where posture depended on an env var being
    // present. Not exploitable today (no Access-Control-Allow-Credentials is
    // ever sent, and these routes are Bearer-authenticated, so a browser
    // cannot ride a session), but permissive-by-default is the wrong default.
    if (env.isProduction) return "";
    return reqOrigin || "*";
  }
  return allowed.includes(reqOrigin) ? reqOrigin : allowed[0];
}

export async function handleRequest(req, res) {
  const start = Date.now();
  const reqOrigin = req.headers.origin;
  const origin = resolveAllowedOrigin(reqOrigin);

  let url;
  try {
    url = new URL(req.url ?? "/", `http://localhost`);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  logRequest(req, url);

  const done = (status) => {
    logResponse(req, res, url, Date.now() - start);
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin });
    res.end();
    done();
    return;
  }

  if (url.pathname === "/health" && req.method === "GET") {
    sendJson(res, origin, 200, { status: "ok" });
    done();
    return;
  }

  if (url.pathname === "/api/notify/readiness" && req.method === "GET") {
    sendJson(res, origin, 200, { status: "ok", service: "vt-notify-api" });
    done();
    return;
  }

  const handled =
    (await routeEmail(req, res, url, origin)) ||
    (await routePhone(req, res, url, origin)) ||
    (await routePush(req, res, url, origin));

  if (!handled) {
    sendJson(res, origin, 404, { success: false, error: "Not found" });
  }

  done();
}
