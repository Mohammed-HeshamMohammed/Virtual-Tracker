// Simple request/response logger
import { getEnv } from "../config/env.js";
import { sanitizePathForLog } from "../http/sanitize-log.js";
import { formatErrorForLog, logSafeError } from "../http/sanitize-error.js";

export { logSafeError };
import { recordRequest } from "./metrics.js";

const startTimes = new WeakMap();

export function logRequest(req) {
  const start = Date.now();
  startTimes.set(req, start);
  const timestamp = new Date().toISOString();
  const origin = req.headers.origin || "-";
  const safeUrl = sanitizePathForLog(req.url ?? "/");
  console.log(`[${timestamp}] → ${req.method} ${safeUrl} (origin: ${origin})`);
}

export function logResponse(req, res, url) {
  const start = startTimes.get(req) || Date.now();
  const duration = Date.now() - start;
  const timestamp = new Date().toISOString();
  const path = url?.pathname || sanitizePathForLog(req.url ?? "/");
  const status = res.statusCode || 200;
  const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : status >= 300 ? "\x1b[36m" : "\x1b[32m";
  const reset = "\x1b[0m";
  console.log(`[${timestamp}] ← ${color}${status}${reset} ${req.method} ${path} (${duration}ms)`);
  // Skip recording monitor API paths to avoid polluting metrics
  if (!path.startsWith("/monitor")) {
    recordRequest({
      method: req.method || "GET",
      path,
      status,
      ms: duration,
      ip: (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "-").split(",")[0].trim(),
      ua: req.headers["user-agent"] || "-",
    });
  }
}

export function logStartup({ version, port, nodeEnv, routes }) {
  const reset = "\x1b[0m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  console.log("");
  console.log(`${cyan}╔══════════════════════════════════════════════════════╗${reset}`);
  console.log(`${cyan}║${reset}  ${green}Virtual Tracker API${reset}                                 ${cyan}║${reset}`);
  console.log(`${cyan}╠══════════════════════════════════════════════════════╣${reset}`);
  console.log(`${cyan}║${reset}  Version : ${yellow}${version}${reset}                                     ${cyan}║${reset}`);
  console.log(`${cyan}║${reset}  Port    : ${yellow}${port}${reset}                                      ${cyan}║${reset}`);
  console.log(`${cyan}║${reset}  Node    : ${yellow}${process.version}${reset}                                  ${cyan}║${reset}`);
  console.log(`${cyan}║${reset}  Env     : ${yellow}${nodeEnv}${reset}                               ${cyan}║${reset}`);
  console.log(`${cyan}╠══════════════════════════════════════════════════════╣${reset}`);
  console.log(`${cyan}║${reset}  Registered routes:                                  ${cyan}║${reset}`);
  for (const route of routes.slice(0, 12)) {
    const padded = route.padEnd(42, " ");
    console.log(`${cyan}║${reset}    ${green}✓${reset} ${padded.substring(0, 42)}${cyan}      ║${reset}`);
  }
  if (routes.length > 12) {
    console.log(`${cyan}║${reset}    ... and ${routes.length - 12} more                                   ${cyan}║${reset}`);
  }
  console.log(`${cyan}╚══════════════════════════════════════════════════════╝${reset}`);
  console.log(`${green}Server ready at http://localhost:${port}${reset}`);
  console.log("");
}

export function logError(err, context = "") {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] \x1b[31mERROR\x1b[0m ${context}: ${formatErrorForLog(err)}`);
  if (err instanceof Error && err.stack && !getEnv().isProduction) {
    console.error(err.stack.split("\n").slice(0, 3).join("\n"));
  }
}

export function logDbStatus(initialized, error) {
  const timestamp = new Date().toISOString();
  if (initialized) {
    console.log(`[${timestamp}] \x1b[32m✓\x1b[0m Firebase/Firestore connected`);
  } else {
    console.log(`[${timestamp}] \x1b[33m⚠\x1b[0m Firestore not configured (${error || "no credentials"})`);
  }
}
