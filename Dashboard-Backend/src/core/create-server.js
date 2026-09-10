import { createServer as createNodeServer } from "node:http";
import { handleRequest } from "../app/handle-request.js";
import { sanitizePathForLog } from "../http/sanitize-log.js";
import { quotaErrorHttpResponse } from "../http/quota-error.js";
import { sendJson } from "../http/response.js";
import { logRequest, logResponse, logError } from "./logger.js";
import { runWithAuditActor } from "../lib/postgres/audit-actor.js";

export function createServer() {
  // Every request runs inside its own audit-actor scope, so a write made
  // while handling it can be attributed to whoever authenticated - without an
  // actor argument threaded through every service function.
  const server = createNodeServer((req, res) => runWithAuditActor(async () => {
    let url;
    logRequest(req);
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      await handleRequest(req, res);
    } catch (err) {
      logError(err, `${req.method} ${sanitizePathForLog(req.url ?? "/")}`);
      if (!res.headersSent) {
        const origin = req.headers.origin;
        const quota = quotaErrorHttpResponse(err);
        if (quota) {
          sendJson(res, origin, quota.status, quota.body, req);
        } else {
          sendJson(
            res,
            origin,
            500,
            { success: false, error: err instanceof Error ? err.message : "Internal server error" },
            req,
          );
        }
      }
    } finally {
      logResponse(req, res, url);
    }
  }));
  return server;
}
