import { sendEmailVerification, type User } from "firebase/auth"
import { apiFetch } from "@/lib/api/http"
import { getFirebaseAuthContinueUrl } from "@/lib/auth/continue-url"
import { formatAuthError } from "@/lib/auth/format-auth-error"

export function isEmailPasswordAccount(user: User | null): boolean {
  return user?.providerData?.some((p) => p.providerId === "password") ?? false
}

export function needsEmailVerification(user: User | null, profile?: { emailVerified?: boolean } | null): boolean {
  if (!user || !isEmailPasswordAccount(user)) return false
  if (user.emailVerified || profile?.emailVerified) return false
  return true
}

type SendVerificationEmailResponse = { success?: boolean; sent?: boolean; code?: string; error?: string }

async function sendVerificationEmailWithBackend(continueUrl: string): Promise<{ delivered: boolean }> {
  try {
    const res = await apiFetch("/api/auth/send-verification-email", {
      method: "POST",
      body: JSON.stringify(continueUrl ? { continueUrl } : {}),
    })
    const data = (await res.json().catch(() => null)) as SendVerificationEmailResponse | null
    return { delivered: Boolean(res.ok && data?.sent) }
  } catch {
    return { delivered: false }
  }
}

export async function sendVerificationEmailToUser(user: User): Promise<void> {
  const continueUrl = getFirebaseAuthContinueUrl()
  const backendResult = await sendVerificationEmailWithBackend(continueUrl)
  if (backendResult.delivered) return
  await sendEmailVerification(user, { url: continueUrl })
}

export function formatVerificationEmailError(err: unknown): string {
  return formatAuthError(err)
}

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email address before signing in. Check your inbox for a verification link."
