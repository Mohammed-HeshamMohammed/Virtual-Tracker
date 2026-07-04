/**
 * Detect Firestore / gRPC quota exhaustion from thrown errors.
 */

export function isFirestoreQuotaError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "")
  const lower = msg.toLowerCase()
  return (
    lower.includes("resource_exhausted") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota_exceeded") ||
    /\b8\s+resource_exhausted\b/i.test(msg)
  )
}

/** @returns {{ status: number, body: object } | null} */
export function quotaErrorHttpResponse(err) {
  if (!isFirestoreQuotaError(err)) return null
  const message = err instanceof Error ? err.message : String(err ?? "Firebase quota exceeded")
  return {
    status: 503,
    body: {
      success: false,
      error: message.includes("Quota exceeded") ? message : "Firebase quota exceeded. Please try again later.",
      code: "RESOURCE_EXHAUSTED",
    },
  }
}
