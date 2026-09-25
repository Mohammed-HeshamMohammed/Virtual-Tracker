"use client"

import { AlertTriangle } from "lucide-react"
import { useAuth } from "@/shared/providers/app"
import { isManagementRole } from "@/features/auth"
import { usePolicyHealth } from "@/features/settings/hooks/use-policy-health"

const LABELS: Record<string, string> = {
  screenshots: "Screenshots",
  app_tracking: "Application tracking",
  url_capture: "URL capture",
  integrity_signals: "Integrity signals",
}

/**
 * Says so when data is being thrown away. A capability that is switched off
 * looks exactly like a tracker that has stopped working - the data never arrives
 * and nothing says why - so management is told, with what was lost and where to
 * fix it. Nothing is shown when nothing is being discarded.
 */
export function PolicyHealthBanner({ activeItem, onNavigate }: { activeItem: string; onNavigate: (id: string) => void }) {
  const { memberRole } = useAuth()
  const { health } = usePolicyHealth(isManagementRole(memberRole), activeItem)

  // The console it links to already shows the same thing in more detail.
  if (!health?.discarding || activeItem === "settings-compliance") return null

  const lost = health.capabilities.filter((c) => c.discarding)

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Some tracked data is being discarded</p>
          <p className="mt-0.5 text-amber-800 dark:text-amber-200/90">
            {lost
              .map((c) => `${LABELS[c.capability] ?? c.capability} is switched off (${c.dropped} item${c.dropped === 1 ? "" : "s"} from ${c.members} ${c.members === 1 ? "person" : "people"} in the last ${health.days} days)`)
              .join(". ")}
            . Trackers are still capturing it; it is thrown away when it arrives.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onNavigate("settings-compliance")}
        className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
      >
        Fix in Compliance
      </button>
    </div>
  )
}
