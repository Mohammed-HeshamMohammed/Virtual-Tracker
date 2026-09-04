/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
export function readBearerToken(req) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader !== "string") return "";
  // `\s+` beside `.+` backtracks quadratically on a header of repeated
  // whitespace that never matches. `\S` anchors the first captured char so
  // there is nothing for the engine to re-split.
  const match = /^Bearer\s+(\S.*)$/i.exec(authHeader.trim());
  return match?.[1] || "";
}

/**
 * Bearer from Authorization header; else query/body token (legacy clients).
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} [url]
 * @param {{ idToken?: unknown }} [body]
 * @returns {string}
 */
export function readIdToken(req, url, body) {
  const bearer = readBearerToken(req);
  if (bearer) return bearer;
  const fromQuery = url?.searchParams?.get("idToken") || url?.searchParams?.get("token");
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;
  if (body && typeof body.idToken === "string" && body.idToken) return body.idToken;
  return "";
}
