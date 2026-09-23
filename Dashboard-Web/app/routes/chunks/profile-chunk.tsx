"use client"

import { ProfilePage } from "@/features/profile"
import { NotificationsPage } from "@/features/notifications/pages/notifications-page"
import type { PageChunkProps } from "@/app/routes/types"

export default function ProfileChunk({ pageId, onNavigate, pageParams }: PageChunkProps) {
  // Notifications rides in this chunk rather than its own: it is a small,
  // personal page like the profile, and a separate chunk would be a whole
  // extra network round trip for one screen.
  if (pageId === "notifications") {
    return <NotificationsPage onNavigate={onNavigate} pageParams={pageParams} />
  }
  return <ProfilePage onNavigate={onNavigate} />
}
