"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { DashboardView, DashboardViewData, GeneralDashboardPayload } from "@/features/dashboard/components/general/constants"

type GeneralDashboardContextValue = {
  view: DashboardView
  setView: (view: DashboardView) => void
  viewData: DashboardViewData | null
  payload: GeneralDashboardPayload | null
  loading: boolean
  error: string | null
  refreshing: boolean
  canAccessAllView: boolean
  retry: () => void
}

const GeneralDashboardContext = createContext<GeneralDashboardContextValue | null>(null)

export function GeneralDashboardProvider({
  children,
  view,
  setView,
  payload,
  loading,
  error,
  refreshing,
  retry,
}: {
  children: ReactNode
  view: DashboardView
  setView: (view: DashboardView) => void
  payload: GeneralDashboardPayload | null
  loading: boolean
  error: string | null
  refreshing: boolean
  retry: () => void
}) {
  const canAccessAllView = payload?.canAccessAllView ?? false
  const viewData = payload ? (view === "all" ? payload.all : payload.me) : null

  return (
    <GeneralDashboardContext.Provider
      value={{
        view,
        setView,
        viewData,
        payload,
        loading,
        error,
        refreshing,
        canAccessAllView,
        retry,
      }}
    >
      {children}
    </GeneralDashboardContext.Provider>
  )
}

export function useGeneralDashboard() {
  const ctx = useContext(GeneralDashboardContext)
  if (!ctx) {
    throw new Error("useGeneralDashboard must be used within GeneralDashboardProvider")
  }
  return ctx
}

export function useGeneralDashboardOptional() {
  return useContext(GeneralDashboardContext)
}
