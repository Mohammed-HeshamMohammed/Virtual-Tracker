import { isSensitiveFieldName } from "./sensitive-fields.js";

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
