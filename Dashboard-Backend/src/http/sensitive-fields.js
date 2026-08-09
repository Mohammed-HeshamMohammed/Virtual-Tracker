/** Field names that must never appear in logs, URLs, or error output. */
export const SENSITIVE_FIELD_NAMES = new Set([
  "password",
  "confirmpassword",
  "confirm_password",
  "newpassword",
  "new_password",
  "currentpassword",
  "current_password",
  "oldpassword",
  "old_password",
  "passcode",
  "secret",
  "idtoken",
  "id_token",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "api_key",
  "apikey",
]);

const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * @param {string} value
 */
export function redactSensitiveValue(value) {
  if (!value) return value;
  if (JWT_LIKE.test(value)) return "[REDACTED_JWT]";
  if (value.length > 24) return "[REDACTED]";
  return "[REDACTED]";
}

/**
 * @param {string} key
 */
export function isSensitiveFieldName(key) {
  return SENSITIVE_FIELD_NAMES.has(String(key).toLowerCase());
}

/**
 * @param {URL} url
 */
export function urlHasSensitiveQueryParams(url) {
  for (const key of url.searchParams.keys()) {
    if (isSensitiveFieldName(key)) return true;
    const value = url.searchParams.get(key);
    if (value && JWT_LIKE.test(value)) return true;
  }
  return false;
}
