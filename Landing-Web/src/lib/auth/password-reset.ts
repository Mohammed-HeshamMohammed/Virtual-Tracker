import { sendPasswordResetEmail } from "firebase/auth"
import { getFirebaseAuthClient } from "@/lib/firebase-client"
import { getFirebaseAuthContinueUrl } from "@/lib/auth/continue-url"
import { errorCodeOf, formatAuthError } from "@/lib/auth/format-auth-error"

export const PASSWORD_RESET_SUCCESS_MESSAGE =
  "If an account exists for this email address, a password reset link has been sent."

/**
 * Sends Firebase Authentication's built-in password reset email.
 * Does not reveal whether the email is registered (enumeration-safe).
 */
export async function sendFirebasePasswordResetEmail(email: string): Promise<void> {
  const trimmed = email.trim()
  const auth = getFirebaseAuthClient()
  try {
    await sendPasswordResetEmail(auth, trimmed, { url: getFirebaseAuthContinueUrl() })
  } catch (err) {
    if (errorCodeOf(err) === "auth/user-not-found") return
    throw new Error(formatAuthError(err))
  }
}
