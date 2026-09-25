"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getPolicyHealth, POLICY_CHANGED_EVENT, type PolicyHealth } from "@/features/settings/api/compliance-api"

const MIN_GAP_MS = 20_000

/**
 * The collection policy's health, for management only. A page change is a cheap
 * moment to re-check, but not worth a request each time, so ordinary refreshes
 * are rate-limited; a policy change bypasses the limit because the person who
 * just fixed it expects the warning to go.
 */
export function usePolicyHealth(enabled: boolean, refreshKey: string) {
  const [health, setHealth] = useState<PolicyHealth | null>(null)
  const lastFetch = useRef(0)

  const load = useCallback(async (force: boolean) => {
    if (!force && Date.now() - lastFetch.current < MIN_GAP_MS) return
    lastFetch.current = Date.now()
    try {
      setHealth(await getPolicyHealth())
    } catch {
      // A failed check is not evidence that anything is wrong, so it must not
      // raise a warning - keep whatever was last known.
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setHealth(null)
      return
    }
    void load(false)
  }, [enabled, refreshKey, load])

  useEffect(() => {
    if (!enabled) return
    const onChanged = () => void load(true)
    window.addEventListener(POLICY_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(POLICY_CHANGED_EVENT, onChanged)
  }, [enabled, load])

  return { health, refresh: () => load(true) }
}
