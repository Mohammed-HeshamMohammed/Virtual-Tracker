import { getRedirectResult, type Auth, type UserCredential } from "firebase/auth"

/** One `getRedirectResult` per full page load (React Strict Mode mounts twice in dev). */
let redirectResultPromise: Promise<UserCredential | null> | null = null

/**
 * Completes a pending `signInWithRedirect` handshake once per tab load.
 */
export function consumeAuthRedirectResultOnce(auth: Auth): Promise<UserCredential | null> {
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth).catch((err) => {
      redirectResultPromise = null
      throw err
    })
  }
  return redirectResultPromise
}

/** Strip Firebase OAuth query/hash leftovers after redirect completes. */
export function cleanFirebaseAuthUrl(): void {
  if (typeof window === "undefined") return
  const { pathname, search, hash } = window.location
  const hasAuthQuery =
    /[?&](apiKey|authUser|mode|oobCode|continueUrl)=/.test(search) ||
    /[?&](apiKey|authUser|mode)=/.test(hash) ||
    hash.includes("id_token=") ||
    hash.includes("access_token=")
  if (!hasAuthQuery) return
  window.history.replaceState({}, document.title, pathname)
}
