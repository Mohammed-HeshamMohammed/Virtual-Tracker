import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, type Auth } from "firebase/auth"

function isPopupBlocked(err: unknown): boolean {
  const code = err && typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : ""
  return code === "auth/popup-blocked"
}

/** Popup first (avoids fragile full-page redirect handshakes), redirect fallback when blocked. */
export async function signInWithGoogleAccount(auth: Auth): Promise<void> {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: "select_account" })

  try {
    await signInWithPopup(auth, provider)
  } catch (err) {
    if (isPopupBlocked(err)) {
      await signInWithRedirect(auth, provider)
      return
    }
    throw err
  }
}
