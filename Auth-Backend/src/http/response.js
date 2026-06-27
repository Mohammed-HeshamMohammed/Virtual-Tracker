import { gzipSync } from "node:zlib";
import { enrichErrorPayload } from "./api-error.js";
import { corsHeaders } from "./cors.js";
import { getSecurityHeaders } from "./security-headers.js";

const MIN_GZIP_BYTES = 512;

/**
 * @param {import("node:http").ServerResponse} res
 * @param {string|undefined} origin
 * @param {number} status
 * @param {unknown} payload
 * @param {import("node:http").IncomingMessage} [req]
 * @param {Record<string, string>} [extraHeaders]
 */
export function sendJson(res, origin, status, payload, req, extraHeaders = {}) {
  const body = JSON.stringify(enrichErrorPayload(status, payload));
  // extraHeaders merge last — per-route Cache-Control in routes.js overrides security-headers no-store.
  const headers = {
    ...corsHeaders(origin),
    ...getSecurityHeaders(req),
    ...extraHeaders,
    "Content-Type": "application/json; charset=utf-8",
  };

  const accept = typeof req?.headers?.["accept-encoding"] === "string" ? req.headers["accept-encoding"] : "";
  if (accept.includes("gzip") && body.length >= MIN_GZIP_BYTES) {
    const compressed = gzipSync(body);
    res.writeHead(status, {
      ...headers,
      "Content-Encoding": "gzip",
      "Content-Length": compressed.length,
      Vary: "Accept-Encoding",
    });
    res.end(compressed);
    return;
  }

  res.writeHead(status, headers);
  res.end(body);
}
