"use client"

import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import { FALLBACK_PASSWORD_POLICY } from "@/features/auth/services/password-policy/defaults"
import { fetchPasswordPolicy, getCachedPasswordPolicy } from "@/features/auth/services/password-policy/fetch-policy"
import type { PasswordPolicyResponse } from "@/features/auth/services/password-policy/types"

type PasswordPolicyContextValue = {
  policy: PasswordPolicyResponse
  loading: boolean
  fromCache: boolean
}

const PasswordPolicyContext = createContext<PasswordPolicyContextValue | null>(null)

export function PasswordPolicyProvider({ children }: { children: React.ReactNode }) {
  const [policy, setPolicy] = useState<PasswordPolicyResponse>(
    () => getCachedPasswordPolicy() ?? FALLBACK_PASSWORD_POLICY,
  )
  const [loading, setLoading] = useState(true)
  const [fromCache, setFromCache] = useState(() => getCachedPasswordPolicy() !== null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fetched = await fetchPasswordPolicy()
      if (cancelled) return
      setPolicy(fetched)
      setFromCache(getCachedPasswordPolicy() !== null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      policy,
      loading,
      fromCache,
    }),
    [policy, loading, fromCache],
  )

  return <PasswordPolicyContext.Provider value={value}>{children}</PasswordPolicyContext.Provider>
}

export function usePasswordPolicy(): PasswordPolicyContextValue {
  const ctx = useContext(PasswordPolicyContext)
  if (!ctx) {
    return {
      policy: FALLBACK_PASSWORD_POLICY,
      loading: false,
      fromCache: true,
    }
  }
  return ctx
}
