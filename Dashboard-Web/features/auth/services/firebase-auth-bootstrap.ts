import { getRedirectResult, type Auth, type UserCredential } from "firebase/auth"

let redirectResultPromise: Promise<UserCredential | null> | null = null

export function consumeAuthRedirectResultOnce(auth: Auth): Promise<UserCredential | null> {
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth).catch((err) => {
      redirectResultPromise = null
      throw err
    })
  }
  return redirectResultPromise
}

const FIREBASE_EMAIL_ACTION_PATH = "/auth/action"
const FIREBASE_EMAIL_ACTION_MODES = new Set(["verifyEmail", "resetPassword", "recoverEmail"])

function isFirebaseEmailActionUrl(): boolean {
  if (typeof window === "undefined") return false
  if (window.location.pathname !== FIREBASE_EMAIL_ACTION_PATH) return false
  const params = new URLSearchParams(window.location.search)
  const mode = params.get("mode")?.trim() ?? ""
  if (FIREBASE_EMAIL_ACTION_MODES.has(mode)) return true
  return Boolean(params.get("oobCode")?.trim())
}

export function hasFirebaseAuthCallbackInUrl(): boolean {
  if (typeof window === "undefined") return false
  if (isFirebaseEmailActionUrl()) return false
  const { search, hash } = window.location
  return (
    /[?&](apiKey|authUser|mode|state|code)=/.test(search) ||
    /[?&](apiKey|authUser|mode|state|code)=/.test(hash) ||
    hash.includes("id_token=") ||
    hash.includes("access_token=")
  )
}

export const GOOGLE_REDIRECT_FAILED_MESSAGE =
  "Google sign-in could not be completed. Try again, allow popups for this site, or use email and password instead."

export function cleanFirebaseAuthUrl(): void {
  if (typeof window === "undefined") return
  if (isFirebaseEmailActionUrl()) return
  const { pathname, search, hash } = window.location
  const hasAuthQuery =
    /[?&](apiKey|authUser|mode|oobCode|continueUrl)=/.test(search) ||
    /[?&](apiKey|authUser|mode)=/.test(hash) ||
    hash.includes("id_token=") ||
    hash.includes("access_token=")
  if (!hasAuthQuery) return
  window.history.replaceState({}, document.title, pathname)
}
