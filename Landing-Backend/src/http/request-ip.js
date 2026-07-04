/**
 * Resolve the client IP from proxy headers or the socket.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
export function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}
