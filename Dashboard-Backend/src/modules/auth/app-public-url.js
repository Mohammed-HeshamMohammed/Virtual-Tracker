import { getEnv } from "../../config/env.js";

/**
 * @param {string | undefined} override Origin from client request (e.g. window.location.origin).
 * @returns {string}
 */
export function resolveAppPublicUrl(override) {
  if (typeof override === "string" && override.trim().startsWith("http")) {
    return override.trim().replace(/\/+$/, "");
  }
  const { urls } = getEnv();
  const fromEnv = urls.appPublicUrl || urls.frontendOrigin;
  return fromEnv.replace(/\/+$/, "");
}
