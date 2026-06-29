"use client"

import { Loader2, AlertCircle, RefreshCw } from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"

export function WidgetShell({
  children,
  className,
  loading,
  error,
  onRetry,
  empty,
  emptyMessage = "No data yet",
}: {
  children: React.ReactNode
  className?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  empty?: boolean
  emptyMessage?: string
}) {
  const { isDark } = useTheme()
  const t = getDashboardStatusStyles(isDark)

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col items-center justify-center gap-2 rounded-3xl border p-6 shadow-sm",
          t.panel,
          className,
        )}
      >
        <Loader2 className={cn("h-5 w-5 animate-spin", t.accent)} aria-hidden />
        <p className={cn("text-xs font-medium", t.bodySub)}>Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col items-center justify-center rounded-3xl border p-4", t.panel, className)}>
        <DashboardStatusContent
          isDark={isDark}
          icon={AlertCircle}
          iconTone="warning"
          title="Section unavailable"
          description={error}
          primaryLabel={onRetry ? "Retry" : undefined}
          primaryIcon={RefreshCw}
          onPrimary={onRetry}
        />
      </div>
    )
  }

  if (empty) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm",
          className,
        )}
      >
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>
    )
  }

  return <div className={cn("h-full", className)}>{children}</div>
}

export function PanelShell({
  title,
  subtitle,
  icon,
  iconClassName,
  action,
  children,
  className,
  loading,
  error,
  onRetry,
  empty,
  emptyMessage,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  iconClassName?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  empty?: boolean
  emptyMessage?: string
}) {
  return (
    <WidgetShell
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={empty}
      emptyMessage={emptyMessage}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-7",
        className,
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white",
              iconClassName ?? "bg-emerald-500",
            )}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900">{title}</h3>
            {subtitle ? <p className="truncate text-xs text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </WidgetShell>
  )
}

export function StatShell({
  icon,
  iconClassName,
  label,
  value,
  className,
  loading,
  error,
  onRetry,
}: {
  icon: React.ReactNode
  iconClassName?: string
  label: string
  value: string
  className?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}) {
  return (
    <WidgetShell
      loading={loading}
      error={error}
      onRetry={onRetry}
      className={cn(
        "relative flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white",
          iconClassName ?? "bg-emerald-500",
        )}
      >
        {icon}
      </div>
      <div className="min-h-0 flex-1 flex flex-col justify-end">
        <p className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{value}</p>
        <p className="mt-1 truncate text-sm font-medium text-slate-500">{label}</p>
      </div>
    </WidgetShell>
  )
}
