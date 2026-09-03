"use client"

import { MemberPresenceReporter } from "@/features/auth/components/member-presence-reporter"
import { PresenceEventsSubscriber } from "@/features/auth/components/presence-events-subscriber"

export function DashboardPresenceSync() {
  return (
    <>
      <MemberPresenceReporter />
      <PresenceEventsSubscriber />
    </>
  )
}
