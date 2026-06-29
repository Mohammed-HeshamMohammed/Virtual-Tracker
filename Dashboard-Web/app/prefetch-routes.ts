import { canAccessAllSidebarTabs } from "@/features/auth"
import { CHUNK_IMPORTS } from "@/app/routes/chunk-loaders"
import { resolveChunkId } from "@/app/routes/resolve-chunk"
import type { AppChunkId } from "@/app/routes/types"

const PRIVILEGED_WARMUP: AppChunkId[] = ["people", "projects", "activity"]
const STANDARD_WARMUP: AppChunkId[] = ["people", "activity", "settings"]

let prefetchStarted = false

function prefetchChunk(id: AppChunkId) {
  void CHUNK_IMPORTS[id]()
}

/**
 * After login, prefetch likely route chunks during idle time (smaller first paint, faster tab switches).
 */
export function prefetchAppRoutesForRole(role: string) {
  if (prefetchStarted || typeof window === "undefined") return
  prefetchStarted = true

  const chunks = canAccessAllSidebarTabs(role) ? PRIVILEGED_WARMUP : STANDARD_WARMUP

  const run = () => {
    for (const id of chunks) prefetchChunk(id)
  }

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 4000 })
  } else {
    setTimeout(run, 1500)
  }
}

/** Call from sidebar / topbar hover to prefetch a domain before click. */
export function prefetchChunkForPage(pageId: string) {
  if (typeof window === "undefined") return
  prefetchChunk(resolveChunkId(pageId))
}
