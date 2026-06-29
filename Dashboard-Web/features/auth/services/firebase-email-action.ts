import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode, type Auth } from "firebase/auth"

export type FirebaseEmailActionMode = "verifyEmail" | "resetPassword" | "recoverEmail" | "unknown"

export function parseFirebaseEmailActionMode(value: string | null): FirebaseEmailActionMode {
  switch (value) {
    case "verifyEmail":
    case "resetPassword":
    case "recoverEmail":
      return value
    default:
      return "unknown"
  }
}

export async function readEmailVerificationTarget(auth: Auth, oobCode: string): Promise<string> {
  const info = await checkActionCode(auth, oobCode)
  const email = typeof info.data.email === "string" ? info.data.email.trim().toLowerCase() : ""
  return email
}

export async function completeFirebaseEmailAction(auth: Auth, oobCode: string): Promise<void> {
  await applyActionCode(auth, oobCode)
}

export async function readPasswordResetEmail(auth: Auth, oobCode: string): Promise<string> {
  return verifyPasswordResetCode(auth, oobCode)
}

export async function completeFirebasePasswordReset(auth: Auth, oobCode: string, newPassword: string): Promise<void> {
  await confirmPasswordReset(auth, oobCode, newPassword)
}

export function resolveEmailActionContinuePath(continueUrl: string | null): string {
  if (!continueUrl) return "/?emailVerified=1"
  try {
    const url = new URL(continueUrl)
    if (!url.searchParams.has("emailVerified")) {
      url.searchParams.set("emailVerified", "1")
    }
    return `${url.pathname}${url.search}`
  } catch {
    return "/?emailVerified=1"
  }
}

export function resolvePasswordResetContinuePath(continueUrl: string | null): string {
  if (!continueUrl) return "/?passwordUpdated=1"
  try {
    const url = new URL(continueUrl)
    url.searchParams.set("passwordUpdated", "1")
    return `${url.pathname}${url.search}`
  } catch {
    return "/?passwordUpdated=1"
  }
}
