import { SERVICE_REQUEST_FAILED_MESSAGE } from "@/infrastructure/api/backend-connection-events"
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, type User } from "firebase/auth"
import { validatePasswordWithBackend } from "@/features/auth/api/validate-password-api"
import { formatAuthError } from "@/features/auth/services/format-auth-error"
import { validatePassword } from "@/shared/validation"
import type { PasswordPolicyRules } from "@/features/auth/services/password-policy/types"
import { notifyPasswordChanged } from "@/features/auth/api/security-notify-api"

export function formatPasswordChangeError(err: unknown): string {
  const code =
    err && typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : ""
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "Current password is incorrect."
  }
  if (code === "auth/weak-password") {
    return "New password is too weak. Choose a stronger password."
  }
  if (code === "auth/requires-recent-login") {
    return "Please sign in again and retry changing your password."
  }
  if (code === "auth/network-request-failed") {
    return SERVICE_REQUEST_FAILED_MESSAGE
  }
  return formatAuthError(err)
}

export async function changePasswordWithReauth(
  user: User,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  policy?: PasswordPolicyRules,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = user.email
  if (!email) {
    return { ok: false, error: "Your account has no email address for re-authentication." }
  }
  if (!currentPassword.trim()) {
    return { ok: false, error: "Current password is required." }
  }

  const structuralError = validatePassword(newPassword, {
    confirmPassword,
    requireConfirm: true,
    policy,
  })
  if (structuralError) {
    return { ok: false, error: structuralError }
  }

  const backendValidation = await validatePasswordWithBackend(newPassword, confirmPassword)
  if (!backendValidation.valid) {
    return {
      ok: false,
      error: backendValidation.error ?? "Password does not meet security requirements.",
    }
  }

  try {
    const credential = EmailAuthProvider.credential(email, currentPassword)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, newPassword)
    void notifyPasswordChanged()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: formatPasswordChangeError(err) }
  }
}
