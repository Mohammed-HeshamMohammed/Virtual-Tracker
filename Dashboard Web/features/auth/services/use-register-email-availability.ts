"use client"

import { useEffect, useState } from "react"
import { fetchSignInMethodsForEmailSafe } from "@/features/auth/services/sign-in-method-guard"
import { resolveSignInMethodsFromApi } from "@/features/auth/api/resolve-sign-in-methods-api"
import { getFirebaseAuth, initFirebase } from "@/infrastructure/firebase/config"
import { isValidEmail } from "@/shared/validation"

export type RegisterEmailAvailability = "idle" | "checking" | "available" | "taken"

const DEBOUNCE_MS = 450

async function lookupRegisterEmailAvailability(email: string): Promise<RegisterEmailAvailability> {
  const trimmed = email.trim().toLowerCase()

  const server = await resolveSignInMethodsFromApi(trimmed)
  if (server?.success) {
    return server.methods.length > 0 ? "taken" : "available"
  }

  try {
    await initFirebase()
    const auth = getFirebaseAuth()
    const methods = await fetchSignInMethodsForEmailSafe(auth, trimmed)
    if (methods === null) return "idle"
    return methods.length > 0 ? "taken" : "available"
  } catch {
    return "idle"
  }
}

export function useRegisterEmailAvailability(email: string, enabled: boolean): RegisterEmailAvailability {
  const [state, setState] = useState<RegisterEmailAvailability>("idle")

  const trimmed = email.trim()
  const shouldCheck = enabled && trimmed.length > 0 && isValidEmail(trimmed)

  const [prevEnabled, setPrevEnabled] = useState(enabled)
  const [prevEmail, setPrevEmail] = useState(email)
  if (enabled !== prevEnabled || email !== prevEmail) {
    setPrevEnabled(enabled)
    setPrevEmail(email)
    if (!shouldCheck) {
      setState("idle")
    } else {
      setState("checking")
    }
  }

  useEffect(() => {
    if (!shouldCheck) return

    let cancelled = false

    const timer = window.setTimeout(() => {
      void lookupRegisterEmailAvailability(trimmed).then((result) => {
        if (!cancelled) setState(result)
      })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [shouldCheck, trimmed])

  return state
}

export function registerEmailStatusBadge(
  isRegisterMode: boolean,
  email: string,
  availability: RegisterEmailAvailability,
): "checking" | "success" | "error" | null {
  if (!isRegisterMode || !isValidEmail(email.trim())) return null
  if (availability === "checking") return "checking"
  if (availability === "available") return "success"
  if (availability === "taken") return "error"
  return null
}
