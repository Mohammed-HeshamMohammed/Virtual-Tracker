/** Backend / database infrastructure failures (distinct from auth gate errors). */

export class ServiceUnavailableError extends Error {
  readonly code: string

  constructor(message: string, code = "SERVICE_UNAVAILABLE") {
    super(message)
    this.name = "ServiceUnavailableError"
    this.code = code
  }
}

export function isServiceUnavailableError(error: unknown): error is ServiceUnavailableError {
  return error instanceof ServiceUnavailableError
}

export function isInfrastructureError(error: unknown): boolean {
  if (error instanceof ServiceUnavailableError) return true
  const msg = error instanceof Error ? error.message : String(error ?? "")
  const lower = msg.toLowerCase()
  return (
    lower.includes("service unavailable") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("unable to reach the database")
  )
}

export function infrastructureErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return "Our service is temporarily unavailable. Please try again shortly."
}
