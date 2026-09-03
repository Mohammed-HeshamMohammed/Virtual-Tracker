import { isSensitiveFieldName, redactSensitiveValue } from "./sensitive-fields.js";
import { getEnv } from "../config/env.js";

const SENSITIVE_IN_MESSAGE =
  /(password|passcode|idtoken|id_token|access_token|refresh_token|authorization|api[_-]?key)\s*[:=]\s*\S+/gi;

function redactUnknown(value, depth = 0) {
  if (depth > 4) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveValue(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, depth + 1));
  }

  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveFieldName(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactUnknown(nested, depth + 1);
  }
  return out;
}

export function sanitizeErrorMessage(err) {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  return message.replace(SENSITIVE_IN_MESSAGE, "[REDACTED]");
}

export function formatErrorForLog(err) {
  const message = sanitizeErrorMessage(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String(err.code)
      : "";
  return code ? `${code}: ${message}` : message;
}

export function logSafeError(context, err) {
  console.error(context, formatErrorForLog(err));
  if (err instanceof Error && err.stack && !getEnv().isProduction) {
    const safeStack = err.stack
      .split("\n")
      .slice(0, 3)
      .map((line) => line.replace(SENSITIVE_IN_MESSAGE, "[REDACTED]"))
      .join("\n");
    console.error(safeStack);
  }
}

export function logSafeWarn(context, detail) {
  const message =
    detail instanceof Error
      ? formatErrorForLog(detail)
      : typeof detail === "string"
        ? sanitizeErrorMessage(detail)
        : JSON.stringify(redactUnknown(detail));
  console.warn(context, message);
}

export { redactUnknown };
