import { isSensitiveFieldName } from "./sensitive-fields.js";

/**
 * Reject requests that carry credential-shaped values in the query string.
 *
 * @param {URL} url
 * @returns {string | null}
 */
export function rejectSensitiveQueryParams(url) {
  for (const key of url.searchParams.keys()) {
    if (isSensitiveFieldName(key)) {
      return "Sensitive credentials must not be sent in the URL.";
    }
  }
  return null;
}
