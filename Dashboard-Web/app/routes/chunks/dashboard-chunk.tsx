"use client"

import { CommandCenter, GeneralDashboard } from "@/features/dashboard"
import type { PageChunkProps } from "@/app/routes/types"

export default function DashboardChunk({ pageId, onNavigate }: PageChunkProps) {
  if (pageId === "command-center") {
    return <CommandCenter onNavigate={onNavigate} />
  }
  return <GeneralDashboard onNavigate={onNavigate} />
}
