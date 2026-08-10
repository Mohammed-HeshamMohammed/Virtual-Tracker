import { createServer as createNodeServer } from "node:http";
import { handleRequest } from "../app/handle-request.js";
import { sanitizePathForLog } from "../http/sanitize-log.js";
import { quotaErrorHttpResponse } from "../http/quota-error.js";
import { sendJson } from "../http/response.js";
import { logRequest, logResponse, logError } from "./logger.js";

export function createServer() {
  const server = createNodeServer(async (req, res) => {
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
  });
  return server;
}
