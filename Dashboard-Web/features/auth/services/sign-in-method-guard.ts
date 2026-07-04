import type { Auth } from "firebase/auth"
import { fetchSignInMethodsForEmail } from "firebase/auth"
import { resolveSignInMethodsFromApi } from "@/features/auth/api/resolve-sign-in-methods-api"

function uniqStrings(values: string[]): string[] {
// eslint-disable-next-line react-doctor/js-flatmap-filter
  return [...new Set(values.map((s) => s.trim()).filter(Boolean))]
}

/** Merge client fetchSignInMethodsForEmail + backend Admin providers. */
export async function fetchSignInMethodsForEmailSafe(auth: Auth, email: string): Promise<string[] | null> {
  const trimmed = email.trim()
  if (!trimmed) return null
  let client: string[] | null = null
  try {
    client = await fetchSignInMethodsForEmail(auth, trimmed)
  } catch {
    client = null
  }
  const server = await resolveSignInMethodsFromApi(trimmed.toLowerCase())
  if (server && !server.success) {
    throw new Error(server.error)
  }
  const serverMethods =
    server && server.success && Array.isArray(server.methods) ? server.methods : []
  const merged = uniqStrings([...(client ?? []), ...serverMethods])
  if (merged.length === 0 && client === null && server === null) return null
  return merged
}

const has = (methods: string[], m: string) => methods.includes(m)

/** User message when email has no password provider on file. */
export function instructionWhenNoPasswordOnFile(methods: string[]): string {
  const g = has(methods, "google.com")
  const a = has(methods, "apple.com")
  const l = has(methods, "emailLink")

  if (g && !a && !l) {
    return "For this app, that email is registered with Google only. Use the Google button to sign in—email and password will not work for this address."
  }
  if (a && !g && !l) {
    return "For this app, that email is registered with Apple only. Use the Apple ID button to sign in—email and password will not work for this address."
  }
  if (l && !g && !a) {
    return "For this app, that email is set up for sign-in by email link only. Use “Sign in with work email” and open the message we send you—do not use the password field."
  }
  if (g && a && !l) {
    return "For this app, that email is registered with Google or Apple (not with a password here). Use the Google or Apple button—pick the one you used when you first signed up."
  }
  if (g && l && !a) {
    return "For this app, that email uses Google and/or email link sign-in, not the password field. Use the Google button, or “Sign in with work email” and your inbox link."
  }
  if (a && l && !g) {
    return "For this app, that email uses Apple and/or email link sign-in, not the password field. Use the Apple ID button, or “Sign in with work email” and your inbox link."
  }
  if (g && a && l) {
    return "For this app, that email is not set up for password sign-in. Use Google, Apple, or “Sign in with work email” (email link)—whichever you used when you registered."
  }
  return "For this app, that email is not set up for email-and-password sign-in. Use Google, Apple, or “Sign in with work email” according to how you first created the account."
}

/** Guidance when account exists but methods list is empty/unknown. */
export function describeExistingAccountGuidance(methods: string[]): string {
  if (methods.length === 0) {
    return "Firebase did not return which sign-in methods exist for this address (privacy protection). Try the Google button if you used Google, the Apple button if you used Apple, or “Sign in with work email” if you used email links; otherwise check the password you chose."
  }
  if (has(methods, "password") && (has(methods, "google.com") || has(methods, "apple.com") || has(methods, "emailLink"))) {
    return "This email has a password and may also be linked to Google, Apple, or email link. Sign in the same way you usually do: password form, Google, Apple, or work-email link."
  }
  if (has(methods, "password")) {
    return "This email is registered with a password. Sign in with your email and password on this form (do not create a new account)."
  }
  return instructionWhenNoPasswordOnFile(methods)
}

export function assertCanSignInWithEmailAndPassword(methods: string[] | null, email: string): void {
  if (methods === null) return
  if (methods.length === 0) return
  if (methods.includes("password")) return
  throw new Error(instructionWhenNoPasswordOnFile(methods))
}

export function assertCanRegisterWithEmailAndPassword(methods: string[] | null, email: string): void {
  if (methods === null) return
  if (methods.length === 0) return
  throw new Error(`An account already exists for ${email}. ${describeExistingAccountGuidance(methods)}`)
}

export function assertCanSendEmailSignInLink(methods: string[] | null, email: string): void {
  if (methods === null) return
  if (methods.length === 0) return
  if (methods.includes("emailLink")) return
  if (methods.includes("password")) {
    throw new Error(
      `This email is registered with a password. Sign in on the main form with your email and password, not the email link flow.`
    )
  }
  if (methods.includes("google.com") && !methods.includes("emailLink")) {
    throw new Error(
      "That email is registered with Google only for this app. Use the Google button—not the work-email link—unless you add email link in Firebase."
    )
  }
  if (methods.includes("apple.com") && !methods.includes("emailLink")) {
    throw new Error(
      "That email is registered with Apple only for this app. Use the Apple ID button—not the work-email link—unless you add email link in Firebase."
    )
  }
  throw new Error(`You can’t use an email sign-in link for ${email} with the current sign-in methods. ${describeExistingAccountGuidance(methods)}`)
}

/** After OAuth error account-exists-with-different-credential */
export async function messageForAccountExistsWithDifferentCredential(auth: Auth, error: unknown): Promise<string> {
  const email = getEmailFromAccountExistsError(error)
  if (!email) {
    return "That email is already in use with another sign-in method. Close this popup and use the method you used when you first registered (Google, Apple, password, or work email link)."
  }
  const methods = await fetchSignInMethodsForEmailSafe(auth, email)
  if (methods && methods.length > 0) {
    if (methods.includes("password") && !methods.includes("google.com") && !methods.includes("apple.com")) {
      return "That email already has a password account. Use “Sign in” with your email and password on the main form, not this provider button."
    }
    if (!methods.includes("password")) {
      return instructionWhenNoPasswordOnFile(methods)
    }
    return `That email is already in use. ${describeExistingAccountGuidance(methods)}`
  }
  return describeExistingAccountGuidance([])
}

function getEmailFromAccountExistsError(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null
  if ((error as { code: string }).code !== "auth/account-exists-with-different-credential") return null
  const custom = (error as { customData?: { email?: string } }).customData
  if (custom && typeof custom.email === "string" && custom.email) return custom.email
  return null
}

export function isAccountExistsWithDifferentCredential(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "auth/account-exists-with-different-credential"
  )
}

/** Firebase often returns these for “wrong password”, “no user”, or “OAuth-only account” (enumeration-safe). */
export function isAmbiguousEmailPasswordFailureCode(code: string): boolean {
  return (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-login-credentials"
  )
}

export function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code
  }
  return ""
}
