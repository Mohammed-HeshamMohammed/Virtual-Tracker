/**
 * CORS: this API authenticates every request with a Firebase Bearer token
 * (never cookies), so there is no credentialed cross-origin request to
 * protect against — allow any origin to read responses.
 */
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  };
}

export function applyCors(res) {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}
