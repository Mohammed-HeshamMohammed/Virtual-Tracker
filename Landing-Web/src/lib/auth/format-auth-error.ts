export function isBenignAuthCancellation(err: unknown): boolean {
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"
}

export function formatAuthError(err: unknown): string {
  if (isBenignAuthCancellation(err)) return ""
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  if (code === "auth/operation-not-allowed") {
    return "This sign-in method is disabled for this project. Contact support."
  }
  if (code === "auth/unauthorized-domain") {
    return "This site's domain is not allowed for sign-in. Contact support."
  }
  if (code === "auth/invalid-continue-uri") {
    return "This sign-in link URL is not allowed. Open the app at its canonical domain and try again."
  }
  if (code === "auth/popup-blocked") {
    return "Your browser blocked the Google sign-in popup. Allow popups for this site and try again."
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "This email is already registered with a different sign-in method. Use the method you used the first time."
  }
  if (code === "auth/email-already-in-use") {
    return "This email is already in use. Sign in with the same method you used when you first created the account."
  }
  if (code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") {
    return "Incorrect email or password. If you never set a password for this account, use Google instead."
  }
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
    return "This verification link has expired or was already used. Request a new one from the sign-in page."
  }
  if (code === "auth/user-not-found") {
    return "No account with that email. Check spelling, or try Google if you signed up that way."
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a few minutes and try again."
  }
  if (code === "auth/network-request-failed") {
    return "Could not reach the server. Check your connection and try again."
  }
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

export function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code
  }
  return ""
}
