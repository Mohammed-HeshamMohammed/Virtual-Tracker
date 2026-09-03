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
