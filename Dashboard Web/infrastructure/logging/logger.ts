const SENSITIVE_IN_MESSAGE =
  /(password|passcode|idtoken|id_token|access_token|refresh_token|authorization|api[_-]?key)\s*[:=]\s*\S+/gi

function sanitizeMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message.replace(SENSITIVE_IN_MESSAGE, "[REDACTED]")
  }
  if (typeof value === "string") {
    return value.replace(SENSITIVE_IN_MESSAGE, "[REDACTED]")
  }
  try {
    return JSON.stringify(value).replace(SENSITIVE_IN_MESSAGE, "[REDACTED]")
  } catch {
    return "[unserializable]"
  }
}

/** Client-side safe logging — never emit tokens, passwords, or secrets to the console. */
export function logSafeError(context: string, detail?: unknown): void {
  if (detail === undefined) {
    console.error(context)
    return
  }
  console.error(context, sanitizeMessage(detail))
}

export function logSafeWarn(context: string, detail?: unknown): void {
  if (detail === undefined) {
    console.warn(context)
    return
  }
  console.warn(context, sanitizeMessage(detail))
}
