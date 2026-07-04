const DASHBOARD_API_URL = process.env.NEXT_PUBLIC_DASHBOARD_API_URL?.trim() ?? ""

export type SessionStatus = {
  signedIn: boolean
  displayName: string | null
  avatarUrl: string | null
}

const SIGNED_OUT: SessionStatus = { signedIn: false, displayName: null, avatarUrl: null }

/**
 * Checks the shared session cookie against Dashboard-Backend to see if the
 * visitor is already signed into the dashboard. Never throws — a failed or
 * unconfigured check just means "show the Sign in button".
 */
export async function fetchSessionStatus(): Promise<SessionStatus> {
  if (!DASHBOARD_API_URL) return SIGNED_OUT
  try {
    const res = await fetch(`${DASHBOARD_API_URL}/api/auth/session-status`, {
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

/**
 * Clears the shared session cookie from the landing page. Only affects the
 * landing page's "signed in" awareness — it does not force-sign-out an
 * active dashboard tab, which manages its own Firebase session separately.
 */
export async function logoutSharedSession(): Promise<void> {
  if (!DASHBOARD_API_URL) return
  try {
    await fetch(`${DASHBOARD_API_URL}/api/auth/session-logout`, {
      method: "POST",
      credentials: "include",
    })
  } catch {
    /* non-critical */
  }
}

