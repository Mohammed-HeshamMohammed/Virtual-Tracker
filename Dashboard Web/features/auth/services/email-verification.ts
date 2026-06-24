import { SERVICE_REQUEST_FAILED_MESSAGE } from "@/infrastructure/api/backend-connection-events"
import { sendVerificationEmailWithBackend } from "@/features/auth/api/send-verification-email-api"
import { getFirebaseAuthContinueUrl } from "@/features/auth/services/auth-continue-url"
import { formatAuthError } from "@/features/auth/services/format-auth-error"
import { logSafeWarn } from "@/infrastructure/logging/logger"
import { sendEmailVerification, type User } from "firebase/auth"

export function isEmailPasswordAccount(user: User | null): boolean {
  return user?.providerData?.some((p) => p.providerId === "password") ?? false
}

export function needsEmailVerification(
  user: User | null,
  profile?: { emailVerified?: boolean } | null,
): boolean {
  if (!user || !isEmailPasswordAccount(user)) return false
  if (user.emailVerified || profile?.emailVerified) return false
  return true
}

export async function sendVerificationEmailToUser(user: User): Promise<void> {
  const continueUrl = getFirebaseAuthContinueUrl()
  const backendResult = await sendVerificationEmailWithBackend(continueUrl)
  if (backendResult.delivered) return

  if (backendResult.code === "EMAIL_SEND_FAILED") {
    throw new Error(backendResult.error ?? "Could not send verification email.")
  }

  if (backendResult.code === "REQUEST_FAILED") {
    logSafeWarn(
      "[auth/email-verification] Backend delivery unavailable; falling back to Firebase:",
      backendResult.error,
    )
  }

  await sendEmailVerification(user, { url: continueUrl })
}

export function formatVerificationEmailError(err: unknown): string {
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  if (code === "auth/too-many-requests") {
    return "Too many verification emails sent. Please wait a few minutes and try again."
  }
  if (code === "auth/network-request-failed") {
    return SERVICE_REQUEST_FAILED_MESSAGE
  }
  return formatAuthError(err)
}

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email address before using the application. Check your inbox for a verification link."
