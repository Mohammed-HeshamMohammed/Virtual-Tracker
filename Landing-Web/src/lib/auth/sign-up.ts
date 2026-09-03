"use client"

import { createUserWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from "firebase/auth"
import { initFirebase, getFirebaseAuthClient } from "@/lib/firebase-client"
import { applyAuthPersistenceRememberMe } from "@/lib/auth-persistence"
import { assertCanRegisterWithEmailAndPassword, fetchSignInMethodsForEmailSafe } from "@/lib/auth/sign-in-method-guard"
import { validatePasswordWithBackend } from "@/lib/auth/validate-password-api"
import { patchProfileSettingsWithBackend } from "@/lib/auth/profile-api"
import { sendVerificationEmailToUser } from "@/lib/auth/email-verification"
import { formatAuthError } from "@/lib/auth/format-auth-error"
import { suppressNextAuthStateSync } from "@/lib/auth/auth-state-sync"

export type RegisterOptions = {
  firstName: string
  lastName: string
  phone?: string
  rememberMe?: boolean
}

export async function registerWithEmailPassword(email: string, password: string, options: RegisterOptions): Promise<void> {
  const trimmed = email.trim()
  const firstName = options.firstName.trim()
  const lastName = options.lastName.trim()
  if (!firstName || !lastName) {
    throw new Error("First and last name are required.")
  }

  const passwordCheck = await validatePasswordWithBackend(password)
  if (passwordCheck.valid === false) {
    throw new Error(passwordCheck.error || "Password does not meet requirements.")
  }

  await initFirebase()
  const auth = getFirebaseAuthClient()
  await applyAuthPersistenceRememberMe(auth, options.rememberMe ?? true)

  const methods = await fetchSignInMethodsForEmailSafe(auth, trimmed).catch(() => null)
  assertCanRegisterWithEmailAndPassword(methods, trimmed)

  let cred
  try {
    cred = await createUserWithEmailAndPassword(auth, trimmed, password)
  } catch (err) {
    throw new Error(formatAuthError(err))
  }

  suppressNextAuthStateSync()

  const displayName = `${firstName} ${lastName}`.trim()
  try {
    await updateProfile(cred.user, { displayName })
  } catch {
    /* non-critical */
  }

  try {
    await patchProfileSettingsWithBackend({ firstName, lastName, ...(options.phone ? { phone: options.phone } : {}) })
  } catch {
    /* non-critical — the account still works without these fields saved */
  }

  try {
    await sendVerificationEmailToUser(cred.user)
  } finally {
    await firebaseSignOut(auth)
  }
}
