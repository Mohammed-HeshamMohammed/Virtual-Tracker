import { isSensitiveFieldName } from "./sensitive-fields.js";

/** Block credential-like values in query strings. */
export function rejectSensitiveQueryParams(url) {
  for (const key of url.searchParams.keys()) {
    if (isSensitiveFieldName(key)) {
      return "Sensitive credentials must not be sent in the URL.";
    }
  }
  return null;
}
