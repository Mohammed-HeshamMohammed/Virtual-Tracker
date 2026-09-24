"use client"

import { useEffect } from "react"
import { PeopleTeamScopeProvider } from "@/features/members/context/people-team-scope-context"
import { ActivityFeedProvider, useActivityFeedContext } from "@/features/activity"
import { ActivityShell } from "@/features/activity"
import type { ActivitySubPage } from "@/features/activity/components/activity-shell-context"
import { ActivityScreenshots } from "@/features/activity"
import { ActivityAppsContent } from "@/features/activity"
import { ActivityURLsContent } from "@/features/activity"
import { ActivityToolsPage } from "@/features/activity/components/activity-tools-page"
import { RemovalRequestsPage } from "@/features/activity/components/removal-requests-page"
import type { PageChunkProps } from "@/app/routes/types"

function ActivityPageContent({ pageId }: { pageId: ActivitySubPage }) {
  switch (pageId) {
    case "activity-apps":
      return <ActivityAppsContent />
    case "activity-urls":
      return <ActivityURLsContent />
    case "activity-screenshots":
    default:
      return <ActivityScreenshots />
  }
}

function ActivityPageGate({ pageId, onNavigate }: PageChunkProps) {
  const { setActivityPageActive } = useActivityFeedContext()
  const subPage: ActivitySubPage =
    pageId === "activity-apps" || pageId === "activity-urls" || pageId === "activity-screenshots"
      ? pageId
      : "activity-screenshots"

  useEffect(() => {
    setActivityPageActive(true)
    return () => setActivityPageActive(false)
  }, [setActivityPageActive])

  return (
    <ActivityShell pageId={subPage} onNavigate={onNavigate}>
      <ActivityPageContent pageId={subPage} />
    </ActivityShell>
  )
}

export default function ActivityChunk(props: PageChunkProps) {
  if (props.pageId === "activity-tools") {
    return <ActivityToolsPage />
  }

  // Outside ActivityShell: a review queue has no use for a day picker,
  // a search box or the project scope toggle.
  if (props.pageId === "activity-removal-requests") {
    return <RemovalRequestsPage />
  }

  return (
    <PeopleTeamScopeProvider>
      <ActivityFeedProvider>
        <ActivityPageGate {...props} />
      </ActivityFeedProvider>
    </PeopleTeamScopeProvider>
  )
}
