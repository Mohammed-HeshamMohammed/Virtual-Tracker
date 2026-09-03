import { isSensitiveFieldName } from "./sensitive-fields.js";

const MAX_PASSWORD_LENGTH = 128;

export function rejectSensitiveQueryParams(url) {
  const isSsePath = url.pathname === "/api/presence/events" || url.pathname === "/api/v1/presence/events";
  for (const key of url.searchParams.keys()) {
    if (isSsePath && (key.toLowerCase() === "token" || key.toLowerCase() === "idtoken" || key.toLowerCase() === "id_token")) {
      continue;
    }
    if (isSensitiveFieldName(key)) {
      return "Sensitive credentials must not be sent in the URL.";
    }
  }
  return null;
}

export function normalizePasswordInput(password) {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required.";
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
