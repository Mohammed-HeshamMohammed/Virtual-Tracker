"use client"

import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  FileWarning,
  Gauge,
  Home,
  LogIn,
  Package,
  RefreshCw,
  SearchX,
  ServerCrash,
  ShieldOff,
  Timer,
  Unplug,
  Wrench,
  LayoutGrid,
  Users,
  Folder,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/shared/utils/utils"
import { useTheme } from "@/shared/providers/app"
import {
  getHttpErrorDefinition,
  normalizeHttpErrorCode,
  type HttpErrorActionKind,
} from "@/shared/errors/http-error-catalog"
import { DASHBOARD_PATH } from "@/features/auth"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"
import { getDashboardStatusStyles } from "@/shared/ui/errors/dashboard-status-theme"
import { useEffect, useState } from "react"

type HttpErrorPageProps = {
  status: number
  detail?: string | null
  onPrimaryAction?: () => void
  onSecondaryAction?: () => void
  standalone?: boolean
}

const STATUS_ICONS: Partial<Record<number, LucideIcon>> = {
  400: AlertCircle,
  401: LogIn,
  403: ShieldOff,
  404: SearchX,
  408: Clock,
  413: Package,
  422: FileWarning,
  429: Gauge,
  500: ServerCrash,
  502: Unplug,
  503: Wrench,
  504: Timer,
}

const QUICK_LINKS = [
  { icon: LayoutGrid, label: "Members", path: DASHBOARD_PATH, pageId: "people-members" },
  { icon: Users, label: "Teams", path: DASHBOARD_PATH, pageId: "people-teams" },
  { icon: Folder, label: "Projects", path: DASHBOARD_PATH, pageId: "pm-projects" },
] as const

function useStandaloneDark(): boolean {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => setIsDark(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return isDark
}

function actionIcon(kind: HttpErrorActionKind): LucideIcon {
  if (kind === "home") return Home
  if (kind === "back") return ArrowLeft
  return RefreshCw
}

function runAction(
  kind: HttpErrorActionKind,
  router: ReturnType<typeof useRouter>,
  override?: () => void,
): void {
  if (override) {
    override()
    return
  }
  if (kind === "home") {
    router.push(DASHBOARD_PATH)
    return
  }
  if (kind === "back") {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
      return
    }
    router.push(DASHBOARD_PATH)
    return
  }
  if (kind === "reload") {
    window.location.reload()
    return
  }
  window.location.reload()
}

export function HttpErrorPage({
  status,
  detail,
  onPrimaryAction,
  onSecondaryAction,
  standalone = false,
}: HttpErrorPageProps) {
  const router = useRouter()
  const theme = useTheme()
  const standaloneDark = useStandaloneDark()
  const isDark = standalone ? standaloneDark : theme.isDark
  const t = getDashboardStatusStyles(isDark)
  const definition = getHttpErrorDefinition(normalizeHttpErrorCode(status))
  const Icon = STATUS_ICONS[definition.status] ?? ServerCrash
  const showDetail = Boolean(detail?.trim()) && definition.showDiagnostics
  const showQuickLinks = definition.status === 404 || definition.status === 403

  const primaryIcon = actionIcon(definition.primaryAction)
  const secondaryIcon = definition.secondaryAction ? actionIcon(definition.secondaryAction) : undefined

  return (
    <DashboardStatusShell isDark={isDark} mode="page">
      <DashboardStatusContent
        isDark={isDark}
        icon={Icon}
        iconTone={definition.status >= 500 ? "error" : "warning"}
        badge={`Error ${definition.status}`}
        subtitle={definition.title}
        title={definition.headline}
        description={definition.description}
        primaryLabel={definition.primaryLabel}
        primaryIcon={primaryIcon}
        onPrimary={() => runAction(definition.primaryAction, router, onPrimaryAction)}
        secondaryLabel={definition.secondaryLabel}
        secondaryIcon={secondaryIcon}
        onSecondary={
          definition.secondaryAction
            ? () => runAction(definition.secondaryAction!, router, onSecondaryAction)
            : undefined
        }
        footer={
          <>
            {showQuickLinks ? (
              <div className="space-y-3">
                <p className={cn("text-xs font-semibold uppercase tracking-wider", t.bodySub)}>Quick links</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {QUICK_LINKS.map((link) => {
                    const LinkIcon = link.icon
                    return (
                      <button
                        key={link.pageId}
                        type="button"
                        onClick={() => router.push(link.path)}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all hover:-translate-y-0.5",
                          t.linkCard,
                          t.heading,
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                            isDark ? "border-[#3d4a3d]/30 bg-[#191f31] text-[#4be277]" : "border-blue-100 bg-blue-50 text-blue-600",
                          )}
                        >
                          <LinkIcon className="h-4 w-4" />
                        </span>
                        {link.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {showDetail ? (
              <details className={cn("group border-t pt-4 text-left", t.diagnosticBorder)}>
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold uppercase tracking-wider select-none",
                    t.bodySub,
                  )}
                >
                  <span>Diagnostic details</span>
                  <span className="transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className={cn("mt-2 overflow-x-auto break-all", t.diagnosticBox)}>{detail}</div>
              </details>
            ) : null}
          </>
        }
      />
    </DashboardStatusShell>
  )
}
