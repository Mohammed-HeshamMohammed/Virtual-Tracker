export function readBearerToken(req) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader !== "string") return "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1] || "";
}

export function readIdToken(req, url, body) {
  const bearer = readBearerToken(req);
  if (bearer) return bearer;
  const fromQuery = url?.searchParams?.get("idToken") || url?.searchParams?.get("token");
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;
  if (body && typeof body.idToken === "string" && body.idToken) return body.idToken;
  return "";
}
