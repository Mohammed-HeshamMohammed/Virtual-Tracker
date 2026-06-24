import { clearFirebaseWebConfigCache } from "@/features/auth/services/backend-config"
import { VT_EMAIL_FOR_SIGNIN, VT_REMEMBER_ME_FOR_SIGNIN } from "@/features/auth/services/storage-keys"
import { clearAllListCaches } from "@/shared/tables/hooks/list-cache-registry"
import { resetFirebaseClient } from "@/infrastructure/firebase/config"
import type { FirebaseOptions } from "firebase/app"

/** Last time soft/hard cache purge ran (ms epoch). */
export const VT_LAST_CACHE_PURGE_AT = "vt_last_cache_purge_at"

/** Firebase project id last bound after a successful backend verify. */
const VT_FIREBASE_PROJECT_ID = "vt_firebase_project_id"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const LOCAL_STORAGE_KEEP = new Set(["theme"])

const LOCAL_PREFIXES = ["vt-", "pm-"]

export class AuthSessionInvalidatedError extends Error {
  constructor() {
    super("auth_session_invalidated")
    this.name = "AuthSessionInvalidatedError"
  }
}

/** Token / project mismatch and similar cases that require a silent full auth reset. */
export function isSuspiciousAuthError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes("audience") ||
    m.includes('"aud"') ||
    (m.includes("incorrect") && m.includes("claim")) ||
    (m.includes("id token") &&
      (m.includes("expired") ||
        m.includes("invalid") ||
        m.includes("revoked") ||
        m.includes("incorrect"))) ||
    (m.includes("firebase project") && m.includes("service account")) ||
    m.includes("wrong issuer") ||
    m.includes("custom token") && m.includes("mismatch")
  )
}

function shouldClearLocalKey(key: string): boolean {
  if (LOCAL_STORAGE_KEEP.has(key)) return false
  if (key.includes("firebase")) return true
  return LOCAL_PREFIXES.some((p) => key.startsWith(p))
}

function clearVtSessionStorage(): void {
  if (typeof window === "undefined") return
  const keys: string[] = []
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i)
    if (key && shouldClearLocalKey(key)) keys.push(key)
  }
  for (const key of keys) sessionStorage.removeItem(key)
}

function clearVtLocalStorage(): void {
  if (typeof window === "undefined") return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key && shouldClearLocalKey(key)) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
}

function touchPurgeTimestamp(): void {
  if (typeof window === "undefined") return
  localStorage.setItem(VT_LAST_CACHE_PURGE_AT, String(Date.now()))
}

/** Soft purge: list caches + session tab data (keeps Firebase auth persistence). */
function purgeSoftBrowserCaches(): void {
  clearAllListCaches()
  clearVtSessionStorage()
  touchPurgeTimestamp()
}

/**
 * Hard purge: sign out Firebase, reset client SDK, clear app storage (theme kept).
 * Silent — no UI messaging.
 */
async function purgeHardBrowserState(): Promise<void> {
  clearAllListCaches()
  clearVtSessionStorage()
  clearVtLocalStorage()
  clearFirebaseWebConfigCache()
  await resetFirebaseClient()
  touchPurgeTimestamp()
  if (typeof window !== "undefined") {
    localStorage.removeItem(VT_FIREBASE_PROJECT_ID)
    localStorage.removeItem(VT_EMAIL_FOR_SIGNIN)
    localStorage.removeItem(VT_REMEMBER_ME_FOR_SIGNIN)
  }
}

export function markAuthProjectBound(projectId: string): void {
  if (typeof window === "undefined" || !projectId) return
  localStorage.setItem(VT_FIREBASE_PROJECT_ID, projectId)
}

/**
 * Cache / tab hygiene AFTER Firebase finishes handling redirect / email-link completion.
 *
 * Important: Never call {@link purgeHardBrowserState} here on cold start — clearing
 * localStorage/sessionStorage keys that contain `"firebase"` can wipe the pending OAuth
 * redirect handshake *before* `getRedirectResult` runs, causing Google sign-in to appear
 * to "do nothing". Project switches are handled by `initFirebase` + token verify failures;
 * aligning `VT_FIREBASE_PROJECT_ID` is enough for UX on backend project changes.
 */
export function runPostAuthRedirectHygiene(config: FirebaseOptions): void {
  if (typeof window === "undefined") return

  const projectId = typeof config.projectId === "string" ? config.projectId : ""
  const storedProject = localStorage.getItem(VT_FIREBASE_PROJECT_ID)
  const lastPurge = Number.parseInt(localStorage.getItem(VT_LAST_CACHE_PURGE_AT) ?? "", 10)
  const dayExpired = !Number.isFinite(lastPurge) || Date.now() - lastPurge >= ONE_DAY_MS
  const projectMismatch = Boolean(storedProject && projectId && storedProject !== projectId)

  if (projectMismatch) {
    if (projectId) markAuthProjectBound(projectId)
    purgeSoftBrowserCaches()
    return
  }

  if (dayExpired) {
    purgeSoftBrowserCaches()
  }
}

/** @deprecated Prefer {@link runPostAuthRedirectHygiene} after `getRedirectResult` (see doc there). Kept name for tooling; same implementation. */
function runStartupBrowserHygiene(config: FirebaseOptions): void {
  runPostAuthRedirectHygiene(config)
}

/** Call when backend rejects a token for project mismatch etc. */
export async function handleSuspiciousAuthFailure(): Promise<never> {
  await purgeHardBrowserState()
  throw new AuthSessionInvalidatedError()
}
