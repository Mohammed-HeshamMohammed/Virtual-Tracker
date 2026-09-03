import { clearFirebaseWebConfigCache } from "@/features/auth/services/backend-config"
import { VT_EMAIL_FOR_SIGNIN, VT_REMEMBER_ME_FOR_SIGNIN } from "@/features/auth/services/storage-keys"
import { clearAllListCaches } from "@/shared/tables/hooks/list-cache-registry"
import { resetFirebaseClient } from "@/infrastructure/firebase/config"
import type { FirebaseOptions } from "firebase/app"

export const VT_LAST_CACHE_PURGE_AT = "vt_last_cache_purge_at"

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

function purgeSoftBrowserCaches(): void {
  clearAllListCaches()
  clearVtSessionStorage()
  touchPurgeTimestamp()
}

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

function runStartupBrowserHygiene(config: FirebaseOptions): void {
  runPostAuthRedirectHygiene(config)
}

export async function handleSuspiciousAuthFailure(): Promise<never> {
  await purgeHardBrowserState()
  throw new AuthSessionInvalidatedError()
}
