const LOCALHOST_ALIASES = new Set(["127.0.0.1", "[::1]", "0.0.0.0"])

/**
 * URL Firebase redirects to after email-link sign-in or password reset.
 * Must match a domain under Firebase Console → Authentication → Settings → Authorized domains.
 */
export function getFirebaseAuthContinueUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_AUTH_CONTINUE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim()

  if (configured) {
    return configured.replace(/\/$/, "")
  }

  if (typeof window === "undefined") {
    return ""
  }

  let origin = window.location.origin
  try {
    const url = new URL(origin)
    if (LOCALHOST_ALIASES.has(url.hostname.toLowerCase())) {
      url.hostname = "localhost"
      origin = url.origin
    }
  } catch {
    // Keep the browser-reported origin when parsing fails.
  }

  const path = window.location.pathname || "/"
  return `${origin}${path}`
}
