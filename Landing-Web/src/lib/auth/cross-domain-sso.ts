import { signInWithCustomToken, type Auth } from "firebase/auth"
import { apiFetch } from "@/lib/api/http"

export async function attemptCrossDomainSilentSignIn(auth: Auth): Promise<boolean> {
  try {
    const statusRes = await apiFetch("/api/auth/session-status", { method: "GET", credentials: "include" }, { requireAuth: false })
    const statusData: unknown = await statusRes.json().catch(() => null)
    const signedIn =
      statusRes.ok &&
      statusData !== null &&
      typeof statusData === "object" &&
      (statusData as { signedIn?: unknown }).signedIn === true
    if (!signedIn) return false

    const exchangeRes = await apiFetch("/api/auth/session-exchange", { method: "POST", credentials: "include" }, { requireAuth: false })
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
