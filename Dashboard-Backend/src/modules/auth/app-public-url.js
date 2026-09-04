import { getEnv } from "../../config/env.js";

// `/\/+$/` backtracks quadratically on a long run of slashes. A plain scan
// does the same job in one pass with nothing to re-try.
function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

export function resolveAppPublicUrl(override) {
  if (typeof override === "string" && override.trim().startsWith("http")) {
    return trimTrailingSlashes(override.trim());
  }
  const { urls } = getEnv();
  const fromEnv = urls.appPublicUrl || urls.frontendOrigin;
  return trimTrailingSlashes(fromEnv);
}
