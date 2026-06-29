/** Firebase / Firestore quota detection helpers. */

export class FirestoreQuotaExceededError extends Error {
  constructor(message = "Firebase quota exceeded") {
    super(message)
    this.name = "FirestoreQuotaExceededError"
  }
}

export function isFirestoreQuotaExceededError(error: unknown): boolean {
  if (error instanceof FirestoreQuotaExceededError) return true
  const msg = error instanceof Error ? error.message : String(error ?? "")
  const lower = msg.toLowerCase()
  return (
    lower.includes("resource_exhausted") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota_exceeded") ||
    /\b8\s+resource_exhausted\b/i.test(msg)
  )
}

export function isQuotaExceededApiPayload(body: { error?: string; code?: string } | null | undefined): boolean {
  if (!body) return false
  if (body.code === "RESOURCE_EXHAUSTED") return true
  return isFirestoreQuotaExceededError(body.error ?? "")
}

export function throwIfQuotaExceeded(status: number, errorText?: string | null, code?: string | null): void {
  if (code === "RESOURCE_EXHAUSTED") {
    throw new FirestoreQuotaExceededError(errorText || "Firebase quota exceeded")
  }
  const text = errorText?.trim() ?? ""
  if (isFirestoreQuotaExceededError(text)) {
    throw new FirestoreQuotaExceededError(text || "Firebase quota exceeded")
  }
}
