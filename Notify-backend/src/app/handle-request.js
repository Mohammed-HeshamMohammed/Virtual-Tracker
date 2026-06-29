/**
 * Notify-Backend request pipeline.
 *
 * Pipeline order:
 *   1. CORS preflight
 *   2. Health / readiness (no auth)
 *   3. Internal-auth guard (all other routes)
 *   4. Domain routing → email | phone | push
 */
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
  if (!allowed.length) return reqOrigin || "*";
  return allowed.includes(reqOrigin) ? reqOrigin : allowed[0];
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
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

  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin });
    res.end();
    done();
    return;
  }

  // 2. Health (unauthenticated)
  if (url.pathname === "/health" && req.method === "GET") {
    sendJson(res, origin, 200, { status: "ok" });
    done();
    return;
  }

  // 3. Readiness (unauthenticated)
  if (url.pathname === "/api/notify/readiness" && req.method === "GET") {
    sendJson(res, origin, 200, { status: "ok", service: "vt-notify-api" });
    done();
    return;
  }

  // 4. Domain routes (all require INTERNAL_SERVICE_SECRET)
  const handled =
    (await routeEmail(req, res, url, origin)) ||
    (await routePhone(req, res, url, origin)) ||
    (await routePush(req, res, url, origin));

  if (!handled) {
    sendJson(res, origin, 404, { success: false, error: "Not found" });
  }

  done();
}
