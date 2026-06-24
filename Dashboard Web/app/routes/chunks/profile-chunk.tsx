"use client"

import { ProfilePage } from "@/features/profile"
import type { PageChunkProps } from "@/app/routes/types"

export default function ProfileChunk({ onNavigate }: PageChunkProps) {
  return <ProfilePage onNavigate={onNavigate} />
}
