"use client"

import { signInWithEmailAndPassword } from "firebase/auth"
import { initFirebase, getFirebaseAuthClient } from "@/lib/firebase-client"
import { applyAuthPersistenceRememberMe } from "@/lib/auth-persistence"
import {
  assertCanSignInWithEmailAndPassword,
  fetchSignInMethodsForEmailSafe,
  instructionWhenNoPasswordOnFile,
  messageForAccountExistsWithDifferentCredential,
} from "@/lib/auth/sign-in-method-guard"
import { signInWithGoogleAccount } from "@/lib/auth/google-sign-in"
import { errorCodeOf, formatAuthError } from "@/lib/auth/format-auth-error"

/** Firebase often returns these for "wrong password", "no user", or "OAuth-only account" (enumeration-safe). */
function isAmbiguousEmailPasswordFailureCode(code: string): boolean {
  return (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-login-credentials"
  )
}

/** Note: verify + session-bootstrap + shared-cookie sync happen centrally in `useCurrentUser`. */
export async function signInWithEmailPassword(email: string, password: string, rememberMe = true): Promise<void> {
  const trimmed = email.trim()
  await initFirebase()
  const auth = getFirebaseAuthClient()
  await applyAuthPersistenceRememberMe(auth, rememberMe)

  const methods = await fetchSignInMethodsForEmailSafe(auth, trimmed).catch(() => null)
  assertCanSignInWithEmailAndPassword(methods)

  try {
    await signInWithEmailAndPassword(auth, trimmed, password)
  } catch (err) {
    const code = errorCodeOf(err)
    if (isAmbiguousEmailPasswordFailureCode(code)) {
      const recheck = await fetchSignInMethodsForEmailSafe(auth, trimmed).catch(() => null)
      if (recheck && recheck.length > 0 && !recheck.includes("password")) {
        throw new Error(instructionWhenNoPasswordOnFile(recheck))
      }
    }
    throw new Error(formatAuthError(err))
  }
}

export async function signInWithGoogle(rememberMe = true): Promise<void> {
  await initFirebase()
  const auth = getFirebaseAuthClient()
  await applyAuthPersistenceRememberMe(auth, rememberMe)
  try {
    await signInWithGoogleAccount(auth)
  } catch (err) {
    if (errorCodeOf(err) === "auth/account-exists-with-different-credential") {
      throw new Error(await messageForAccountExistsWithDifferentCredential(auth, err))
    }
    const message = formatAuthError(err)
    if (!message) return // benign cancellation (user closed the popup)
    throw new Error(message)
  }
}
