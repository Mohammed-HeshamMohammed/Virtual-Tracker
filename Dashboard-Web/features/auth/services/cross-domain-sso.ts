import { apiFetch } from "@/infrastructure/api/http"
import { signInWithCustomToken, type Auth } from "firebase/auth"

/**
 * If the visitor is already signed in on another Virtual Tracker subdomain
 * (via the shared session cookie — e.g. they signed in on the landing page
 * and clicked "Open dashboard"), silently establish a matching Firebase
 * session here too. Firebase's client-side auth state never crosses origins
 * on its own — even under the same project, app.myvirtualtracker.com and
 * myvirtualtracker.com have separate local/IndexedDB persistence.
 */
export async function attemptCrossDomainSilentSignIn(auth: Auth): Promise<boolean> {
  try {
    const statusRes = await apiFetch(
      "/api/auth/session-status",
      { method: "GET", credentials: "include" },
      { requireAuth: false },
    )
    const statusData: unknown = await statusRes.json().catch(() => null)
    const signedIn =
      statusRes.ok &&
      statusData !== null &&
      typeof statusData === "object" &&
      (statusData as { signedIn?: unknown }).signedIn === true
    if (!signedIn) return false

    const exchangeRes = await apiFetch(
      "/api/auth/session-exchange",
      { method: "POST", credentials: "include" },
      { requireAuth: false },
    )
    const exchangeData: unknown = await exchangeRes.json().catch(() => null)
    const customToken =
      exchangeRes.ok &&
      exchangeData !== null &&
      typeof exchangeData === "object" &&
      (exchangeData as { success?: unknown }).success === true &&
      typeof (exchangeData as { customToken?: unknown }).customToken === "string"
        ? (exchangeData as { customToken: string }).customToken
        : null
    if (!customToken) return false

    await signInWithCustomToken(auth, customToken)
    return true
  } catch {
    return false
  }
}
