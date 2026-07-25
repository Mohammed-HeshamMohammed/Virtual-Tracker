import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import type { AppChunkId, PageChunkProps } from "@/app/routes/types"

type ChunkModule = { default: ComponentType<PageChunkProps> }

/** Domain route bundles — loaded on first visit to any page in that domain. */
export const CHUNK_COMPONENTS: Record<AppChunkId, LazyExoticComponent<ComponentType<PageChunkProps>>> = {
  dashboard: lazy(() => import("@/app/routes/chunks/dashboard-chunk") as Promise<ChunkModule>),
  people: lazy(() => import("@/app/routes/chunks/people-chunk") as Promise<ChunkModule>),
  projects: lazy(() => import("@/app/routes/chunks/projects-chunk") as Promise<ChunkModule>),
  activity: lazy(() => import("@/app/routes/chunks/activity-chunk") as Promise<ChunkModule>),
  timesheets: lazy(() => import("@/app/routes/chunks/timesheets-chunk") as Promise<ChunkModule>),
  reports: lazy(() => import("@/app/routes/chunks/reports-chunk") as Promise<ChunkModule>),
  financials: lazy(() => import("@/app/routes/chunks/financials-chunk") as Promise<ChunkModule>),
  settings: lazy(() => import("@/app/routes/chunks/settings-chunk") as Promise<ChunkModule>),
  profile: lazy(() => import("@/app/routes/chunks/profile-chunk") as Promise<ChunkModule>),
  "download-agent": lazy(() => import("@/app/routes/chunks/download-agent-chunk") as Promise<ChunkModule>),
}

/** Raw import fns for idle prefetch (no React wrapper). */
export const CHUNK_IMPORTS: Record<AppChunkId, () => Promise<unknown>> = {
  dashboard: () => import("@/app/routes/chunks/dashboard-chunk"),
  people: () => import("@/app/routes/chunks/people-chunk"),
  projects: () => import("@/app/routes/chunks/projects-chunk"),
  activity: () => import("@/app/routes/chunks/activity-chunk"),
  timesheets: () => import("@/app/routes/chunks/timesheets-chunk"),
  reports: () => import("@/app/routes/chunks/reports-chunk"),
  financials: () => import("@/app/routes/chunks/financials-chunk"),
  settings: () => import("@/app/routes/chunks/settings-chunk"),
  profile: () => import("@/app/routes/chunks/profile-chunk"),
  "download-agent": () => import("@/app/routes/chunks/download-agent-chunk"),
}
