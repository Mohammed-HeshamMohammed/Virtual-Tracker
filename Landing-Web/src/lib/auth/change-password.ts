import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, type User } from "firebase/auth"
import { validatePasswordWithBackend } from "@/lib/auth/validate-password-api"
import { formatAuthError } from "@/lib/auth/format-auth-error"

export function formatPasswordChangeError(err: unknown): string {
  const code = err && typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : ""
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "Current password is incorrect."
  if (code === "auth/weak-password") return "New password is too weak. Choose a stronger password."
  if (code === "auth/requires-recent-login") return "Please sign in again and retry changing your password."
  return formatAuthError(err)
}

export async function changePasswordWithReauth(
  user: User,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = user.email
  if (!email) return { ok: false, error: "Your account has no email address for re-authentication." }
  if (!currentPassword.trim()) return { ok: false, error: "Current password is required." }

  const backendValidation = await validatePasswordWithBackend(newPassword)
  if (backendValidation.valid === false) {
    return { ok: false, error: backendValidation.error ?? "Password does not meet security requirements." }
  }

  try {
    const credential = EmailAuthProvider.credential(email, currentPassword)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, newPassword)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: formatPasswordChangeError(err) }
  }
}
