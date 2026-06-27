import { getEnv } from "../../../config/env/index.js";

function listAllowedOrigins() {
  return getEnv().cors.origins;
}

export function isOriginAllowed(origin) {
  if (!origin) return false;
  return listAllowedOrigins().includes(origin);
}

export function corsHeaders(origin) {
  if (isOriginAllowed(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    };
  }
  return {};
}

export function applyCors(res, origin) {
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}
