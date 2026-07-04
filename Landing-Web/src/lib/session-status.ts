const LANDING_API_URL = process.env.NEXT_PUBLIC_LANDING_API_URL?.trim() ?? ""

export type SessionStatus = {
  signedIn: boolean
  displayName: string | null
  avatarUrl: string | null
}

const SIGNED_OUT: SessionStatus = { signedIn: false, displayName: null, avatarUrl: null }

/** Session status via Landing-Backend proxy — never throws. */
export async function fetchSessionStatus(): Promise<SessionStatus> {
  if (!LANDING_API_URL) return SIGNED_OUT
  try {
    const res = await fetch(`${LANDING_API_URL}/api/session-status`, {
      credentials: "include",
      cache: "no-store",
    })
    if (!res.ok) return SIGNED_OUT
    const data = await res.json()
    if (!data?.signedIn) return SIGNED_OUT
    return {
      signedIn: true,
      displayName: typeof data.displayName === "string" ? data.displayName : null,
      avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
    }
  } catch {
    return SIGNED_OUT
  }
}

/** Clear shared session cookie via Landing-Backend (signs out dashboard too). */
export async function logoutSharedSession(): Promise<void> {
  if (!LANDING_API_URL) return
  try {
    await fetch(`${LANDING_API_URL}/api/session-logout`, {
      method: "POST",
      credentials: "include",
    })
  } catch {
    /* non-critical */
  }
}
