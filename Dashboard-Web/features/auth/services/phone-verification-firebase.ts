import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithPhoneNumber,
  signOut,
  unlink,
  type ConfirmationResult,
  type User,
} from "firebase/auth"
import { initFirebase, getFirebaseAuth } from "@/infrastructure/firebase/config"
import { exchangeFirebasePhoneVerification, formatPhoneE164 } from "@/features/auth/services/phone-verification-api"
import {
  beginPhoneVerificationSession,
  endPhoneVerificationSession,
} from "@/features/auth/services/phone-verification-session"

function hasEmailLikeProvider(user: { providerData: Array<{ providerId: string }> } | null): boolean {
  return Boolean(
    user?.providerData.some((provider) => provider.providerId === "password" || provider.providerId === "google.com"),
  )
}

function isRecaptchaRenderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("recaptcha") && message.includes("already been rendered")
}

/** Ephemeral Firebase users created only for phone OTP — not app sessions. */
export function isEphemeralPhoneVerificationUser(user: User): boolean {
  if (user.isAnonymous) return true
  const providers = user.providerData.map((provider) => provider.providerId)
  return providers.length === 1 && providers[0] === PhoneAuthProvider.PROVIDER_ID
}

export function firebasePhoneErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : ""
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (code === "auth/invalid-phone-number") return "Enter a valid phone number with country code (e.g. +1… or +20…)."
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again."
  if (code === "auth/credential-already-in-use") return "This phone number is already linked to another account."
  if (code === "auth/code-expired") return "Verification code expired. Request a new code."
  if (code === "auth/invalid-verification-code") return "Incorrect verification code."
  if (code === "auth/captcha-check-failed") return "Security check failed. Refresh the page and try again."
  if (code === "auth/billing-not-enabled") {
    return "Firebase SMS requires the Blaze (pay-as-you-go) plan. In Firebase Console open Project settings → Usage and billing → Modify plan, upgrade to Blaze, then retry. For local testing without billing, use Console OTP instead of Firebase SMS."
  }
  if (code === "auth/operation-not-allowed") {
    if (message.includes("region")) {
      return "SMS to this country is not enabled in Firebase. Open Firebase Console → Authentication → Settings → SMS region policy and allow Egypt (EG) and United States (US)."
    }
    return "Phone sign-in is not enabled. In Firebase Console open Authentication → Sign-in method and enable Phone (and Anonymous for verification)."
  }
  if (isRecaptchaRenderError(error)) {
    return "Could not run the security check. Refresh the page and try Send code again."
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return "Could not verify your phone number."
}

async function sendWithVerifier(auth: ReturnType<typeof getFirebaseAuth>, formatted: string, verifier: RecaptchaVerifier) {
  const existingUser = auth.currentUser

  if (existingUser && hasEmailLikeProvider(existingUser)) {
    return linkWithPhoneNumber(existingUser, formatted, verifier)
  }

  // signInWithPhoneNumber sends SMS without signing the user in until confirm().
  return signInWithPhoneNumber(auth, formatted, verifier)
}

export async function sendFirebasePhoneVerificationCode(
  phone: string,
  createVerifier: () => Promise<RecaptchaVerifier>,
): Promise<ConfirmationResult> {
  await initFirebase()
  const auth = getFirebaseAuth()
  const formatted = formatPhoneE164(phone)
  if (!formatted || formatted.length < 8) {
    throw new Error("Enter a valid phone number with country code (e.g. +1… or +20…).")
  }

  try {
    const verifier = await createVerifier()
    return await sendWithVerifier(auth, formatted, verifier)
  } catch (error) {
    if (isRecaptchaRenderError(error)) {
      try {
        const retryVerifier = await createVerifier()
        return await sendWithVerifier(auth, formatted, retryVerifier)
      } catch (retryError) {
        throw new Error(firebasePhoneErrorMessage(retryError))
      }
    }
    throw new Error(firebasePhoneErrorMessage(error))
  }
}

export async function confirmFirebasePhoneVerification(
  confirmationResult: ConfirmationResult,
  code: string,
  phone: string,
): Promise<{ verificationToken: string; phone: string; expiresInSeconds: number }> {
  beginPhoneVerificationSession()
  await initFirebase()
  const auth = getFirebaseAuth()
  const beforeUser = auth.currentUser
  const hadEmailAccount = hasEmailLikeProvider(beforeUser)

  try {
    try {
      await confirmationResult.confirm(code.trim())
    } catch (error) {
      throw new Error(firebasePhoneErrorMessage(error))
    }

    const user = auth.currentUser
    if (!user) {
      throw new Error("Phone verification failed.")
    }

    const idToken = await user.getIdToken(true)
    const result = await exchangeFirebasePhoneVerification(idToken, phone)

    if (hadEmailAccount) {
      try {
        await unlink(user, PhoneAuthProvider.PROVIDER_ID)
      } catch {
        /* phone may already be unlinked */
      }
    } else {
      try {
        const { deleteUser } = await import("firebase/auth")
        await deleteUser(user)
      } catch {
        await signOut(auth).catch(() => {})
      }
    }

    return result
  } finally {
    endPhoneVerificationSession()
  }
}
