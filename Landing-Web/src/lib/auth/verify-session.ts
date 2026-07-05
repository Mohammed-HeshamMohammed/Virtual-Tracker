import { apiFetch } from "@/lib/api/http"
import type { User } from "firebase/auth"

export type AuthProfileSnapshot = {
  uid: string
  primaryEmail: string | null
  emailVerified: boolean
  displayName: string | null
  photoURL: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  mustChangePassword?: boolean
}

export function parseAuthProfileSnapshot(raw: unknown): AuthProfileSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.uid !== "string") return undefined
  const mustChangePasswordRaw = o.must_change_password ?? o.mustChangePassword
  return {
    uid: o.uid,
    primaryEmail: typeof o.primaryEmail === "string" || o.primaryEmail === null ? (o.primaryEmail as string | null) : null,
    emailVerified: Boolean(o.emailVerified),
    displayName: typeof o.displayName === "string" || o.displayName === null ? (o.displayName as string | null) : null,
    photoURL: typeof o.photoURL === "string" || o.photoURL === null ? (o.photoURL as string | null) : null,
    phone: typeof o.phone === "string" || o.phone === null ? (o.phone as string | null) : undefined,
    firstName: typeof o.firstName === "string" || o.firstName === null ? (o.firstName as string | null) : undefined,
    lastName: typeof o.lastName === "string" || o.lastName === null ? (o.lastName as string | null) : undefined,
    mustChangePassword: typeof mustChangePasswordRaw === "boolean" ? mustChangePasswordRaw : undefined,
  }
}

export type VerifyIdTokenResult =
  | { success: true; profile?: AuthProfileSnapshot; memberId?: string }
  | { success: false; error: string }

const verifyInFlightByUid = new Map<string, Promise<VerifyIdTokenResult>>()

/**
 * Verifies the ID token (Auth-Backend) then bootstraps the session (Dashboard-Backend).
 * Coalesces overlapping calls for the same Firebase uid.
 */
export async function verifyIdTokenWithBackend(user: User): Promise<VerifyIdTokenResult> {
  const uid = user.uid?.trim()
  if (uid) {
    const existing = verifyInFlightByUid.get(uid)
    if (existing) return existing
  }
  const promise = verifyIdTokenWithBackendOnce().finally(() => {
    if (uid) verifyInFlightByUid.delete(uid)
  })
  if (uid) verifyInFlightByUid.set(uid, promise)
  return promise
}

function errorFrom(data: unknown, fallback: string): string {
  return data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : fallback
}

async function verifyIdTokenWithBackendOnce(): Promise<VerifyIdTokenResult> {
  let verifyRes: Response
  try {
    verifyRes = await apiFetch("/api/auth/verify", { method: "POST", body: JSON.stringify({}) })
  } catch {
    return { success: false, error: "Failed to fetch" }
  }
  const verifyData: unknown = await verifyRes.json().catch(() => ({}))
  if (!verifyRes.ok) {
    return { success: false, error: errorFrom(verifyData, `HTTP ${verifyRes.status}`) }
  }
  if (!verifyData || typeof verifyData !== "object" || (verifyData as { success?: unknown }).success !== true) {
    return { success: false, error: "Invalid verify response" }
  }

  let bootstrapRes: Response
  try {
    bootstrapRes = await apiFetch("/api/auth/session-bootstrap", { method: "POST", body: JSON.stringify({}) })
  } catch {
    return { success: false, error: "Failed to fetch" }
  }
  const data: unknown = await bootstrapRes.json().catch(() => ({}))
  if (!bootstrapRes.ok) {
    return { success: false, error: errorFrom(data, `HTTP ${bootstrapRes.status}`) }
  }
  if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
    return { success: false, error: "Invalid session bootstrap response" }
  }
  const profile = parseAuthProfileSnapshot((data as { profile?: unknown }).profile)
  const memberIdRaw = (data as { memberId?: unknown }).memberId
  const memberId = typeof memberIdRaw === "string" && memberIdRaw.trim() ? memberIdRaw.trim() : undefined
  return { success: true, ...(profile ? { profile } : {}), ...(memberId ? { memberId } : {}) }
}
