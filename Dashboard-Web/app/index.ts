/**
 * App shell — dashboard layout + lazy route chunks for `app/page.tsx`.
 *
 * ```
 * app/
 * ├── page-content.tsx      Memoized router (Suspense per domain chunk)
 * ├── page-layout.ts        Full-bleed page ids
 * ├── prefetch-routes.ts    Idle prefetch after login
 * └── routes/
 *     ├── resolve-chunk.ts  pageId → domain chunk
 *     ├── chunk-loaders.ts  React.lazy domain imports
 *     └── chunks/           One file per domain (dashboard, people, projects, …)
 *
 * Shell lives in ../layout/ and ../providers/; features in sibling folders (see components/README.md).
 * ```
 */

export { DashboardShell } from "@/app/dashboard-shell"
export { HomeClient } from "@/app/home-client"
export type { AppChunkId, NavigateHandler } from "@/app/routes/types"
export { PageContent } from "@/app/page-content"
export { FULL_BLEED_PAGE_IDS, isFullBleedPage } from "@/app/page-layout"
export { prefetchAppRoutesForRole, prefetchChunkForPage } from "@/app/prefetch-routes"
export { resolveChunkId } from "@/app/routes/resolve-chunk"
