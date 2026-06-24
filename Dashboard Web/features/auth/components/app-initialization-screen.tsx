"use client"

import { useAuth, useTheme } from "@/shared/providers/app"
import { AlertCircle, RefreshCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"

export function AppInitializationScreen() {
  const { appInitProgress, appInitPercent, appInitError, retryInit, currentMember } = useAuth()
  const { isDark } = useTheme()
  const displayName = currentMember?.name?.trim() || "your workspace"

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center px-6",
        isDark ? "bg-[#101417] text-white" : "bg-slate-50 text-slate-900",
      )}
    >
      <div className="w-full max-w-md">
        {appInitError ? (
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">Initialization failed</h2>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">{appInitError}</p>
            <button
              type="button"
              onClick={() => void retryInit()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15">
              <div
                className={cn(
                  "h-6 w-6 rounded-full border-2 border-transparent",
                  isDark ? "border-t-emerald-400" : "border-t-emerald-600",
                )}
                style={{ animation: "vt-init-spin 0.85s linear infinite" }}
              />
            </div>

            <h1 className="text-xl font-bold tracking-tight">Setting up {displayName}</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              We&apos;re loading everything you need before opening Virtual Tracker.
            </p>

            <div className="mt-8 w-full">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>{appInitProgress}</span>
                <span>{appInitPercent}%</span>
              </div>
              <div
                className={cn(
                  "h-2 w-full overflow-hidden rounded-full",
                  isDark ? "bg-[#1e2532]" : "bg-slate-200",
                )}
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(4, appInitPercent)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes vt-init-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
