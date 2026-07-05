import type { Auth } from "firebase/auth"
import { fetchSignInMethodsForEmail } from "firebase/auth"
import { resolveSignInMethodsFromApi } from "@/lib/auth/resolve-sign-in-methods-api"

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((s) => s.trim()).filter(Boolean))]
}

/**
 * Merges client `fetchSignInMethodsForEmail` with the backend Admin lookup
 * (same provider rows as in Firebase Auth console).
 */
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
  if (server && !server.success) throw new Error(server.error)
  const serverMethods = server && server.success && Array.isArray(server.methods) ? server.methods : []
  const merged = uniqStrings([...(client ?? []), ...serverMethods])
  if (merged.length === 0 && client === null && server === null) return null
  return merged
}

const has = (methods: string[], m: string) => methods.includes(m)

/** Clear instruction when this email cannot use email+password (no `password` in Firebase methods). */
export function instructionWhenNoPasswordOnFile(methods: string[]): string {
  const g = has(methods, "google.com")
  if (g) {
    return "That email is registered with Google only. Use the Google button to sign in — email and password will not work for this address."
  }
  return "That email is not set up for email-and-password sign-in. Use Google, or reset your password if you're sure you set one."
}

export function describeExistingAccountGuidance(methods: string[]): string {
  if (methods.length === 0) {
    return "We couldn't determine which sign-in method this address uses. Try Google if you used Google, or check the password you chose."
  }
  if (has(methods, "password")) {
    return "This email is registered with a password. Sign in with your email and password (do not create a new account)."
  }
  return instructionWhenNoPasswordOnFile(methods)
}

export function assertCanSignInWithEmailAndPassword(methods: string[] | null): void {
  if (methods === null || methods.length === 0) return
  if (methods.includes("password")) return
  throw new Error(instructionWhenNoPasswordOnFile(methods))
}

export function assertCanRegisterWithEmailAndPassword(methods: string[] | null, email: string): void {
  if (methods === null || methods.length === 0) return
  throw new Error(`An account already exists for ${email}. ${describeExistingAccountGuidance(methods)}`)
}

function getEmailFromAccountExistsError(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null
  if ((error as { code: string }).code !== "auth/account-exists-with-different-credential") return null
  const custom = (error as { customData?: { email?: string } }).customData
  if (custom && typeof custom.email === "string" && custom.email) return custom.email
  return null
}

/** After OAuth error `account-exists-with-different-credential`. */
export async function messageForAccountExistsWithDifferentCredential(auth: Auth, error: unknown): Promise<string> {
  const email = getEmailFromAccountExistsError(error)
  if (!email) {
    return "That email is already in use with another sign-in method. Use the method you used when you first registered."
  }
  const methods = await fetchSignInMethodsForEmailSafe(auth, email)
  if (methods && methods.length > 0) return describeExistingAccountGuidance(methods)
  return describeExistingAccountGuidance([])
}
