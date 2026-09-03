import { apiFetch } from "@/infrastructure/api/http"
import { parseAuthSessionErrorCode, type AuthSessionErrorCode } from "@/features/auth/services/auth-session-errors"
import { handleSuspiciousAuthFailure, isSuspiciousAuthError } from "@/features/auth/services/browser-state-hygiene"
import { ServiceUnavailableError } from "@/features/auth/services/service-unavailable"
import type { User } from "firebase/auth"

export type AuthProfileIdentity = {
  provider: string
  identifier: string | null
  federatedUid?: string | null
  displayName?: string | null
  photoURL?: string | null
}

export type AuthProfileSnapshot = {
  uid: string
  primaryEmail: string | null
  emailVerified: boolean
  displayName: string | null
  photoURL: string | null
  phoneNumber: string | null
  disabled: boolean
  providers: string[]
  identities: AuthProfileIdentity[]
  authCreationTime: string | null
  authLastSignInTime: string | null
  avatarStoragePath?: string | null
  profileImageData?: string
  profileImageMimeType?: string
  profileImageUpdatedAt?: string | null
  firstName?: string | null
  lastName?: string | null
  payRateUsdPerHour?: number | null
  twoFactorEnabled?: boolean
  mustChangePassword?: boolean
  firstLogin?: boolean
  phone?: string | null
  phoneVerified?: boolean
  timezone?: string | null
}

export function parseAuthProfileSnapshot(raw: unknown): AuthProfileSnapshot | undefined {
  return parseProfile(raw)
}

function parseProfile(raw: unknown): AuthProfileSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.uid !== "string") return undefined
  const identitiesRaw = Array.isArray(o.identities) ? o.identities : []
  const identities: AuthProfileIdentity[] = identitiesRaw
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    .map((row) => ({
      provider: typeof row.provider === "string" ? row.provider : "",
      identifier: typeof row.identifier === "string" || row.identifier === null ? (row.identifier as string | null) : null,
      federatedUid: typeof row.federatedUid === "string" || row.federatedUid === null ? (row.federatedUid as string | null) : undefined,
      displayName: typeof row.displayName === "string" || row.displayName === null ? (row.displayName as string | null) : undefined,
      photoURL: typeof row.photoURL === "string" || row.photoURL === null ? (row.photoURL as string | null) : undefined,
    }))
    .filter((i) => i.provider.length > 0)

  const providers = Array.isArray(o.providers) ? o.providers.filter((p): p is string => typeof p === "string") : []

  const avatarStoragePath =
    typeof o.avatarStoragePath === "string" || o.avatarStoragePath === null
      ? (o.avatarStoragePath as string | null)
      : undefined

  const firstName =
    "firstName" in o && (typeof o.firstName === "string" || o.firstName === null)
      ? (o.firstName as string | null)
      : undefined
  const lastName =
    "lastName" in o && (typeof o.lastName === "string" || o.lastName === null)
      ? (o.lastName as string | null)
      : undefined
  const payRateUsdPerHour =
    "payRateUsdPerHour" in o &&
    (typeof o.payRateUsdPerHour === "number" || o.payRateUsdPerHour === null) &&
    (typeof o.payRateUsdPerHour !== "number" || !Number.isNaN(o.payRateUsdPerHour))
      ? (o.payRateUsdPerHour as number | null)
      : undefined
  const twoFactorEnabled =
    "twoFactorEnabled" in o && typeof o.twoFactorEnabled === "boolean" ? o.twoFactorEnabled : undefined
  const mustChangePasswordRaw = o.must_change_password ?? o.mustChangePassword
  const mustChangePassword =
    typeof mustChangePasswordRaw === "boolean" ? mustChangePasswordRaw : undefined
  const firstLoginRaw = o.first_login ?? o.firstLogin
  const firstLogin = typeof firstLoginRaw === "boolean" ? firstLoginRaw : undefined
  const profileImageData = typeof o.profileImageData === "string" ? o.profileImageData : undefined
  const profileImageMimeType =
    typeof o.profileImageMimeType === "string" ? o.profileImageMimeType : undefined
  const profileImageUpdatedAt =
    typeof o.profileImageUpdatedAt === "string" || o.profileImageUpdatedAt === null
      ? (o.profileImageUpdatedAt as string | null)
      : undefined
  const phone = "phone" in o && (typeof o.phone === "string" || o.phone === null) ? (o.phone as string | null) : undefined
  const phoneVerified = "phoneVerified" in o && typeof o.phoneVerified === "boolean" ? o.phoneVerified : undefined
  const timezone =
    "timezone" in o && (typeof o.timezone === "string" || o.timezone === null) ? (o.timezone as string | null) : undefined

  return {
    uid: o.uid,
    primaryEmail: typeof o.primaryEmail === "string" || o.primaryEmail === null ? (o.primaryEmail as string | null) : null,
    emailVerified: Boolean(o.emailVerified),
    displayName: typeof o.displayName === "string" || o.displayName === null ? (o.displayName as string | null) : null,
    photoURL: typeof o.photoURL === "string" || o.photoURL === null ? (o.photoURL as string | null) : null,
    phoneNumber: typeof o.phoneNumber === "string" || o.phoneNumber === null ? (o.phoneNumber as string | null) : null,
    disabled: Boolean(o.disabled),
    providers,
    identities,
    authCreationTime: typeof o.authCreationTime === "string" || o.authCreationTime === null ? (o.authCreationTime as string | null) : null,
    authLastSignInTime: typeof o.authLastSignInTime === "string" || o.authLastSignInTime === null ? (o.authLastSignInTime as string | null) : null,
    ...(avatarStoragePath !== undefined ? { avatarStoragePath } : {}),
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(payRateUsdPerHour !== undefined ? { payRateUsdPerHour } : {}),
    ...(twoFactorEnabled !== undefined ? { twoFactorEnabled } : {}),
    ...(mustChangePassword !== undefined ? { mustChangePassword } : {}),
    ...(firstLogin !== undefined ? { firstLogin } : {}),
    ...(profileImageData !== undefined ? { profileImageData } : {}),
    ...(profileImageMimeType !== undefined ? { profileImageMimeType } : {}),
    ...(profileImageUpdatedAt !== undefined ? { profileImageUpdatedAt } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(phoneVerified !== undefined ? { phoneVerified } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
  }
}

export type VerifyIdTokenResult =
  | { success: true; profile?: AuthProfileSnapshot; memberId?: string; authorized?: boolean }
  | { success: false; error: string; code?: AuthSessionErrorCode }

const verifyInFlightByUid = new Map<string, Promise<VerifyIdTokenResult>>()

export async function verifyIdTokenWithBackend(user: User): Promise<VerifyIdTokenResult> {
  const uid = user.uid?.trim()
  if (uid) {
    const existing = verifyInFlightByUid.get(uid)
    if (existing) return existing
  }

  const promise = verifyIdTokenWithBackendOnce(user).finally(() => {
    if (uid) verifyInFlightByUid.delete(uid)
  })
  if (uid) verifyInFlightByUid.set(uid, promise)
  return promise
}

async function verifyIdTokenWithBackendOnce(user: User): Promise<VerifyIdTokenResult> {
  let verifyRes: Response
  try {
    verifyRes = await apiFetch("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({}),
    })
  } catch {
    return { success: false, error: "Failed to fetch" }
  }

  const verifyData: unknown = await verifyRes.json().catch(() => ({}))
  if (!verifyRes.ok) {
    const err =
      verifyData && typeof verifyData === "object" && "error" in verifyData && typeof (verifyData as { error: unknown }).error === "string"
        ? (verifyData as { error: string }).error
        : `HTTP ${verifyRes.status}`
    const code = parseAuthSessionErrorCode(verifyData)
    if (isSuspiciousAuthError(err)) {
      await handleSuspiciousAuthFailure()
    }
    if (verifyRes.status === 503 || code === "SERVICE_UNAVAILABLE") {
      throw new ServiceUnavailableError(err || "Service temporarily unavailable", code ?? "SERVICE_UNAVAILABLE")
    }
    return { success: false, error: err, ...(code ? { code } : {}) }
  }
  if (!verifyData || typeof verifyData !== "object" || (verifyData as { success?: unknown }).success !== true) {
    return { success: false, error: "Invalid verify response" }
  }

  let bootstrapRes: Response
  try {
    bootstrapRes = await apiFetch("/api/auth/session-bootstrap", {
      method: "POST",
      body: JSON.stringify({}),
    })
  } catch {
    return { success: false, error: "Failed to fetch" }
  }

  const data: unknown = await bootstrapRes.json().catch(() => ({}))
  if (!bootstrapRes.ok) {
    const err =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${bootstrapRes.status}`
    const code = parseAuthSessionErrorCode(data)
    if (isSuspiciousAuthError(err)) {
      await handleSuspiciousAuthFailure()
    }
    if (bootstrapRes.status === 503 || code === "SERVICE_UNAVAILABLE") {
      throw new ServiceUnavailableError(err || "Service temporarily unavailable", code ?? "SERVICE_UNAVAILABLE")
    }
    return { success: false, error: err, ...(code ? { code } : {}) }
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    return { success: false, error: "Invalid session bootstrap response" }
  }
  const profile = parseProfile((data as { profile?: unknown }).profile)
  const memberIdRaw = (data as { memberId?: unknown }).memberId
  const memberId = typeof memberIdRaw === "string" && memberIdRaw.trim() ? memberIdRaw.trim() : undefined
  const authorizedRaw = (data as { authorized?: unknown }).authorized
  const authorized = typeof authorizedRaw === "boolean" ? authorizedRaw : undefined
  return {
    success: true,
    ...(profile ? { profile } : {}),
    ...(memberId ? { memberId } : {}),
    ...(authorized !== undefined ? { authorized } : {}),
  }
}
