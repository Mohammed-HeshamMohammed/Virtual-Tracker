"use client"

import { useEffect } from "react"
import { changedEvent, type ChangeFrame } from "@/infrastructure/api/change-events"

export type EntityLiveGuardOptions = {
  /** Resource name as published by the backend, e.g. "projects" or "tasks". */
  resource: string
  /** The id of the entity this form is editing. Guard is inert while null. */
  id: string | null
  /** The entity itself was deleted - the open form is now over a dead row. */
  onDeleted: (actor?: string) => void
  /** The entity still exists but changed - safe to offer a reload. */
  onUpdated: (actor?: string) => void
}

/**
 * Reacts when the entity a form is editing changes or vanishes underneath
 * the user (PLAN-livesyncandagenttimer.md §6 Phase 3, Bug C). Filters the
 * resource's broadcast stream (already dispatched by change-events.ts) down
 * to the one id this form cares about - every other change to the same
 * resource is the list page's problem, not this modal's.
 */
export function useEntityLiveGuard({ resource, id, onDeleted, onUpdated }: EntityLiveGuardOptions): void {
  useEffect(() => {
    if (!id) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ChangeFrame>).detail
      if (!detail || detail.id !== id) return
      if (detail.action === "deleted") {
        onDeleted(detail.actor)
      } else {
        onUpdated(detail.actor)
      }
    }
    window.addEventListener(changedEvent(resource), handler)
    return () => window.removeEventListener(changedEvent(resource), handler)
  }, [resource, id, onDeleted, onUpdated])
}
