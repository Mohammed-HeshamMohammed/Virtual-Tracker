"use client"

import { Sparkles } from "lucide-react"
import { useTheme } from "@/shared/providers/app"
import { DashboardStatusShell } from "@/shared/ui/errors/dashboard-status-shell"
import { DashboardStatusContent } from "@/shared/ui/errors/dashboard-status-content"

export function RoutePlaceholder({ title }: { title: string }) {
  const { isDark } = useTheme()

  return (
    <DashboardStatusShell isDark={isDark} mode="embedded">
      <DashboardStatusContent
        isDark={isDark}
        icon={Sparkles}
        iconTone="success"
        badge="Coming soon"
        title={title}
        description="This section is under active development. Check back in a future release."
      />
    </DashboardStatusShell>
  )
}
