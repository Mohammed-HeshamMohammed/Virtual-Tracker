export type AuthSessionErrorCode =
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_BANNED"
  | "DEVICE_BANNED"
  | "NO_MEMBER_PROFILE"
  | "ACCOUNT_INACTIVE"
  | string

export class AuthGateError extends Error {
  readonly code: AuthSessionErrorCode

  constructor(message: string, code: AuthSessionErrorCode) {
    super(message)
    this.name = "AuthGateError"
    this.code = code
  }
}

export function isAuthGateError(err: unknown): err is AuthGateError {
  return err instanceof AuthGateError
}

export function parseAuthSessionErrorCode(data: unknown): AuthSessionErrorCode | undefined {
  if (!data || typeof data !== "object") return undefined
  const code = (data as { code?: unknown }).code
  return typeof code === "string" && code.trim() ? code.trim() : undefined
}

export const VT_AUTH_SESSION_RESTRICTED = "vt-auth-session-restricted"

export function isAccountRestrictionCode(code: AuthSessionErrorCode | undefined): boolean {
  return code === "ACCOUNT_BANNED" || code === "ACCOUNT_DISABLED" || code === "DEVICE_BANNED"
}

export function parseAuthSessionErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback
  const error = (data as { error?: unknown }).error
  return typeof error === "string" && error.trim() ? error.trim() : fallback
}
