// App shell — dashboard layout + lazy route chunks for app/page.tsx.

export { DashboardShell } from "@/app/dashboard-shell"
export { HomeClient } from "@/app/home-client"
export type { AppChunkId, NavigateHandler } from "@/app/routes/types"
export { PageContent } from "@/app/page-content"
export { FULL_BLEED_PAGE_IDS, isFullBleedPage } from "@/app/page-layout"
export { prefetchAppRoutesForRole, prefetchChunkForPage } from "@/app/prefetch-routes"
export { resolveChunkId } from "@/app/routes/resolve-chunk"
