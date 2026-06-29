/** User closed a popup or started a second popup before the first finished — not an actionable error. */
export function isBenignAuthCancellation(err: unknown): boolean {
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"
}

/**
 * User-facing text for common Firebase Auth errors. Many map to Console configuration, not app bugs.
 */
export function formatAuthError(err: unknown): string {
  if (isBenignAuthCancellation(err)) return ""
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  if (code === "auth/operation-not-allowed") {
    return "This sign-in method is disabled for your Firebase project. In Firebase Console open Authentication → Sign-in method, then enable the method you are using: Email/Password, Google, Apple, or Email link (passwordless)."
  }
  if (code === "auth/admin-restricted-operation") {
    return "This operation is blocked by your Firebase project settings. Check Authentication in the Firebase Console and any App Check / blocking rules."
  }
  if (code === "auth/unauthorized-domain") {
    return "This site's domain is not allowed. In Firebase Console: Authentication → Settings → Authorized domains, add this app's host (e.g. localhost and your production domain)."
  }
  if (code === "auth/invalid-continue-uri") {
    return "This sign-in link URL is not allowed by Firebase. Open the app at http://localhost:3000 (not 127.0.0.1 or a LAN IP), or set NEXT_PUBLIC_AUTH_CONTINUE_URL to an authorized URL and add that domain under Authentication → Settings → Authorized domains."
  }
  if (code === "auth/popup-blocked") {
    return "Your browser blocked the Google sign-in popup. Allow popups for this site, or try again after disabling strict popup blockers."
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "This email is already registered with a different sign-in method. Use the same method you used the first time (email/password, Google, or Apple), or the message above may have more detail."
  }
  if (code === "auth/email-already-in-use") {
    return "This email is already in use. Sign in with the same method you used when you first created the account."
  }
  if (code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") {
    return "Incorrect email or password. If you never set a password for this app, use Google, Apple, or “Sign in with work email” instead."
  }
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
    return "This verification link has expired or was already used. Request a new verification email from the sign-in page."
  }
  if (code === "auth/user-not-found") {
    return "No account with that email, or Firebase hid the details. Check spelling, or try Google, Apple, or work-email link if you signed up that way."
  }
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
