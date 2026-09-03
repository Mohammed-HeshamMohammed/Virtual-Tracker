"use client"

import { useEffect } from "react"
import { changedEvent, type ChangeFrame } from "@/infrastructure/api/change-events"

export type EntityLiveGuardOptions = {
  resource: string
  id: string | null
  onDeleted: (actor?: string) => void
  onUpdated: (actor?: string) => void
}

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
