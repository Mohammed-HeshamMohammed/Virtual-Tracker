"use client"

import { MembersPage, MemberTreePage } from "@/features/members"
import { MemberBansPage } from "@/features/members/pages/member-bans-page"
import { TeamsPage } from "@/features/teams"
import type { PageChunkProps } from "@/app/routes/types"

export default function PeopleChunk({ pageId, onNavigate }: PageChunkProps) {
  switch (pageId) {
    case "people-members":
      return <MembersPage onNavigate={onNavigate} />
    case "people-members-tree":
      return <MemberTreePage />
    case "people-member-bans":
      return <MemberBansPage />
    case "people-teams":
      return <TeamsPage />
    default:
      return <MembersPage onNavigate={onNavigate} />
  }
}
