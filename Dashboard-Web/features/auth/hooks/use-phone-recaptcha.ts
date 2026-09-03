"use client"

import { useCallback, useEffect, useRef } from "react"
import { RecaptchaVerifier } from "firebase/auth"
import { getFirebaseAuth, initFirebase } from "@/infrastructure/firebase/config"

export function usePhoneRecaptcha() {
  const hostRef = useRef<HTMLDivElement>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)

  const dispose = useCallback(() => {
    if (verifierRef.current) {
      try {
        verifierRef.current.clear()
      } catch {
        /* ignore */
      }
      verifierRef.current = null
    }
    hostRef.current?.replaceChildren()
  }, [])

  const createVerifier = useCallback(async (): Promise<RecaptchaVerifier> => {
    await initFirebase()
    const host = hostRef.current
    if (!host) {
      throw new Error("Security check is not ready. Wait a moment and try again.")
    }
    dispose()
    const verifier = new RecaptchaVerifier(getFirebaseAuth(), host, { size: "invisible" })
    verifierRef.current = verifier
    return verifier
  }, [dispose])

  useEffect(() => () => dispose(), [dispose])

  return { hostRef, createVerifier, dispose }
}
