import { SERVICE_REQUEST_FAILED_MESSAGE } from "@/infrastructure/api/backend-connection-events"
import { sendPasswordResetEmail } from "firebase/auth"
import { getFirebaseAuth } from "@/infrastructure/firebase/config"
import { getFirebaseAuthContinueUrl } from "@/features/auth/services/auth-continue-url"
import { errorCodeOf } from "@/features/auth/services/sign-in-method-guard"
import { logSafeError } from "@/infrastructure/logging/logger"

export const PASSWORD_RESET_SUCCESS_MESSAGE =
  "If an account exists for this email address, a password reset link has been sent."

export function formatPasswordResetError(err: unknown): string {
  const code = errorCodeOf(err)
  if (code === "auth/invalid-email" || code === "auth/missing-email") {
    return "Enter a valid email address."
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a few minutes and try again."
  }
  if (code === "auth/network-request-failed") {
    return SERVICE_REQUEST_FAILED_MESSAGE
  }
  if (code === "auth/invalid-continue-uri") {
    return "This sign-in link URL is not allowed by Firebase. Contact your administrator or try again from an authorized domain."
  }
  if (err instanceof Error && err.message === "Password reset is only available in the browser.") {
    return err.message
  }
  return "Something went wrong. Please try again later."
}

/**
 * Sends Firebase Authentication's built-in password reset email.
 * Does not reveal whether the email is registered (enumeration-safe).
 */
export async function sendFirebasePasswordResetEmail(email: string): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Password reset is only available in the browser.")
  }

  const trimmed = email.trim()
  const auth = getFirebaseAuth()

  try {
    await sendPasswordResetEmail(auth, trimmed, {
      url: getFirebaseAuthContinueUrl(),
    })
  } catch (err) {
    const code = errorCodeOf(err)
    if (code === "auth/user-not-found") {
      return
    }
    logSafeError("[auth/password-reset]", err)
    throw new Error(formatPasswordResetError(err))
  }
}
