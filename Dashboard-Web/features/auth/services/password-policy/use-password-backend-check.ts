"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { validatePasswordWithBackend } from "@/features/auth/api/validate-password-api"
import type { PasswordPolicyRules } from "@/features/auth/services/password-policy/types"

export type BackendPasswordRequirements = {
  notBlocked: boolean | null
  notSimplePattern: boolean | null
}

type BackendCheckState = {
  valid: boolean | null
  requirements: BackendPasswordRequirements
  error: string | null
  checking: boolean
}

const INITIAL_REQUIREMENTS: BackendPasswordRequirements = {
  notBlocked: null,
  notSimplePattern: null,
}

const INITIAL_STATE: BackendCheckState = {
  valid: null,
  requirements: INITIAL_REQUIREMENTS,
  error: null,
  checking: false,
}

const DEBOUNCE_MS = 500
const inflightChecks = new Map<string, ReturnType<typeof validatePasswordWithBackend>>()

function needsBackendSecurityCheck(policy: PasswordPolicyRules): boolean {
  return (
    policy.blockedPasswordsEnabled ||
    policy.examplePasswordBlacklistEnabled ||
    policy.sequenceDetectionEnabled ||
    policy.repeatedPatternDetectionEnabled
  )
}

function policySecurityKey(policy: PasswordPolicyRules): string {
  return [
    policy.blockedPasswordsEnabled,
    policy.examplePasswordBlacklistEnabled,
    policy.sequenceDetectionEnabled,
    policy.repeatedPatternDetectionEnabled,
  ].join("|")
}

function fetchSharedPasswordSecurityCheck(password: string) {
  const existing = inflightChecks.get(password)
  if (existing) return existing

  const promise = validatePasswordWithBackend(password).finally(() => {
    if (inflightChecks.get(password) === promise) {
      inflightChecks.delete(password)
    }
  })
  inflightChecks.set(password, promise)
  return promise
}

export function usePasswordBackendCheck(password: string, policy: PasswordPolicyRules): BackendCheckState {
  const [state, setState] = useState<BackendCheckState>(INITIAL_STATE)
  const requestIdRef = useRef(0)
  const needsCheck = needsBackendSecurityCheck(policy)
  const policyKey = useMemo(() => policySecurityKey(policy), [policy])

  useEffect(() => {
    if (!needsCheck) {
      setState({
        valid: true,
        requirements: { notBlocked: true, notSimplePattern: true },
        error: null,
        checking: false,
      })
      return
    }

    if (!password) {
      setState(INITIAL_STATE)
      return
    }

    const requestId = ++requestIdRef.current
    setState({
      valid: null,
      requirements: INITIAL_REQUIREMENTS,
      error: null,
      checking: true,
    })

    let cancelled = false
    let debounceTimer: number | undefined
    let retryTimer: number | undefined

    const applyResult = (result: Awaited<ReturnType<typeof validatePasswordWithBackend>>) => {
      if (cancelled || requestId !== requestIdRef.current) return

      if (result.rateLimited) {
        const retryMs = Math.max(1000, (result.retryAfterSec ?? 2) * 1000)
        retryTimer = window.setTimeout(() => {
          void runCheck()
        }, retryMs)
        return
      }

      setState({
        valid: result.valid,
        requirements: result.requirements ?? INITIAL_REQUIREMENTS,
        error: result.error,
        checking: false,
      })
    }

    const runCheck = async () => {
      try {
        const result = await fetchSharedPasswordSecurityCheck(password)
        applyResult(result)
      } catch {
        if (cancelled || requestId !== requestIdRef.current) return
        setState({
          valid: false,
          requirements: { notBlocked: false, notSimplePattern: false },
          error: "Could not validate password. Try again.",
          checking: false,
        })
      }
    }

    debounceTimer = window.setTimeout(() => {
      void runCheck()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      if (debounceTimer) window.clearTimeout(debounceTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [password, policyKey, needsCheck])

  return state
}
