import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, type Auth } from "firebase/auth"
import {
  buildLauncherGoogleOAuthUrl,
  isEmbeddedInLauncherFrame,
  navigateLauncherHost,
  shouldUseGoogleRedirect,
} from "@/features/auth/services/launcher-runtime"

function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: "select_account" })
  return provider
}

function isPopupBlocked(err: unknown): boolean {
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  return code === "auth/popup-blocked"
}

function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false
  const host = window.location.hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
}

/**
 * Launcher / embedded shell: redirect in the host window (popups often open the system browser).
 * Local dev in a normal tab: popup first, redirect fallback when blocked.
 */
export async function signInWithGoogleAccount(auth: Auth): Promise<void> {
  const provider = googleProvider()

  if (isEmbeddedInLauncherFrame()) {
    navigateLauncherHost(buildLauncherGoogleOAuthUrl())
    return
  }

  if (shouldUseGoogleRedirect()) {
    await signInWithRedirect(auth, provider)
    return
  }

  if (isLocalDevHost()) {
    try {
      await signInWithPopup(auth, provider)
      return
    } catch (err) {
      if (isPopupBlocked(err)) {
        await signInWithRedirect(auth, provider)
        return
      }
      throw err
    }
  }

  await signInWithRedirect(auth, provider)
}
