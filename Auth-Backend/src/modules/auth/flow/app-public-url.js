import { getEnv } from "../../../config/env/index.js";

export function resolveAppPublicUrl(override) {
  if (typeof override === "string" && override.trim().startsWith("http")) {
    return override.trim().replace(/\/+$/, "");
  }
  const { urls } = getEnv();
  const fromEnv = urls.appPublicUrl || urls.frontendOrigin || "http://localhost:3000";
  return fromEnv.replace(/\/+$/, "");
}
