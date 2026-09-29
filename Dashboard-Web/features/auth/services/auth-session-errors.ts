export type AuthSessionErrorCode =
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_BANNED"
  | "DEVICE_BANNED"
  | "NO_MEMBER_PROFILE"
  | "ACCOUNT_INACTIVE"
  // PLAN-customer-accounts-and-tenancy.md §0.1 blocker 10 / §14.4: the
  // backend's session-bootstrap and per-request expiry gates emit these
  // when a customer tenant's paid period has lapsed or the account has
  // been removed - session-bootstrap.js is the first place either can
  // surface, since it runs before the ordinary per-request gate.
  | "SUBSCRIPTION_EXPIRED"
  | "TENANT_REMOVED"
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
  return (
    code === "ACCOUNT_BANNED" ||
    code === "ACCOUNT_DISABLED" ||
    code === "DEVICE_BANNED" ||
    code === "SESSION_REVOKED" ||
    isTenantExpiryCode(code)
  )
}

/**
 * §0.1 blocker 10: distinct from an account restriction (someone was
 * banned/disabled) - a whole customer tenant's paid period lapsed or the
 * account was removed. Kept as its own classifier, not folded silently
 * into isAccountRestrictionCode's reasons, so a future UI (§0.2 step 6's
 * dedicated expired-account screen, e.g. a "Renew" call to action) can
 * branch on it without re-deriving which codes mean what.
 */
export function isTenantExpiryCode(code: AuthSessionErrorCode | undefined): boolean {
  return code === "SUBSCRIPTION_EXPIRED" || code === "TENANT_REMOVED"
}

export function parseAuthSessionErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback
  const error = (data as { error?: unknown }).error
  return typeof error === "string" && error.trim() ? error.trim() : fallback
}
