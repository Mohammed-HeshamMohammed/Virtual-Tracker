"use client"

import { useEffect, useState } from "react"
import { fetchActivityFeed } from "@/features/activity/services/activity-api"
import { useAuth } from "@/shared/providers/app"
import type { Screenshot } from "@/features/activity/components/utils"
import type { DashboardView } from "@/features/dashboard/components/general/constants"

type FetchSnapshot = {
  view: DashboardView
  memberId: string | undefined
  isLoggedIn: boolean
}

export function useDashboardScreenshots(view: DashboardView) {
  const { isLoggedIn, memberId } = useAuth()
  const [data, setData] = useState<Screenshot[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const snapshot: FetchSnapshot = { view, memberId, isLoggedIn }
  const [prevSnapshot, setPrevSnapshot] = useState(snapshot)
  if (
    snapshot.view !== prevSnapshot.view ||
    snapshot.memberId !== prevSnapshot.memberId ||
    snapshot.isLoggedIn !== prevSnapshot.isLoggedIn
  ) {
    setPrevSnapshot(snapshot)
    if (!snapshot.isLoggedIn) {
      setLoading(false)
      setError(null)
      setData(null)
    } else {
      setLoading(true)
      setError(null)
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false

    void fetchActivityFeed<Screenshot[]>({
      type: "screenshots",
      memberId: view === "me" && memberId ? memberId : "all",
      projectScopeOnly: view === "all",
    })
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setError("Could not load screenshots")
          setData(null)
        } else {
          setData(result.data)
        }
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError("Failed to load screenshots")
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isLoggedIn, memberId, view])

  return { data, loading, error }
}
