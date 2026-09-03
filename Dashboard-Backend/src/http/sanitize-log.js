import { isSensitiveFieldName, redactSensitiveValue } from "./sensitive-fields.js";

const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function sanitizeUrlForLog(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  const q = rawUrl.indexOf("?");
  if (q < 0) return rawUrl;
  const path = rawUrl.slice(0, q);
  const query = rawUrl.slice(q + 1);
  if (!query) return path;
  try {
    const params = new URLSearchParams(query);
    let changed = false;
    for (const key of [...params.keys()]) {
      if (isSensitiveFieldName(key)) {
        params.set(key, "[REDACTED]");
        changed = true;
      } else {
        const v = params.get(key);
        if (v && JWT_LIKE.test(v)) {
          params.set(key, "[REDACTED_JWT]");
          changed = true;
        } else if (v && v.length > 48) {
          params.set(key, redactSensitiveValue(v));
          changed = true;
        }
      }
    }
    if (!changed) return rawUrl;
    return `${path}?${params.toString()}`;
  } catch {
    return path;
  }
}

export function sanitizePathForLog(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  const withoutHash = pathOrUrl.split("#")[0];
  return sanitizeUrlForLog(withoutHash);
}
