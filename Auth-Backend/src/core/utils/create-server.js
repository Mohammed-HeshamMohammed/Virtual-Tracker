import { createServer as createNodeServer } from "node:http";
import { handleRequest } from "../../app.js";
import { sanitizePathForLog } from "../middleware/http/sanitize-log.js";
import { quotaErrorHttpResponse } from "../middleware/http/quota-error.js";
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
        const quota = quotaErrorHttpResponse(err);
        if (quota) {
          res.writeHead(quota.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(quota.body));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: "Internal server error" }));
        }
      }
    } finally {
      logResponse(req, res, url);
    }
  });
  return server;
}
