"use client"

import { MemberPresenceReporter } from "@/features/auth/components/member-presence-reporter"
import { PresenceEventsSubscriber } from "@/features/auth/components/presence-events-subscriber"

/** Global presence — report status on login and subscribe to live updates app-wide. */
export function DashboardPresenceSync() {
  return (
    <>
      <MemberPresenceReporter />
      <PresenceEventsSubscriber />
    </>
  )
}
