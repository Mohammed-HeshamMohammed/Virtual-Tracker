import { canAccessAllSidebarTabs } from "@/features/auth"
import { isClientRole } from "@/features/auth/permissions/team-member-assign-policy"
import { CHUNK_IMPORTS } from "@/app/routes/chunk-loaders"
import { resolveChunkId } from "@/app/routes/resolve-chunk"
import type { AppChunkId } from "@/app/routes/types"

const PRIVILEGED_WARMUP: AppChunkId[] = ["people", "projects", "activity"]
const STANDARD_WARMUP: AppChunkId[] = ["people", "activity", "settings"]
const CLIENT_WARMUP: AppChunkId[] = ["projects", "reports", "activity"]

let prefetchStarted = false

function prefetchChunk(id: AppChunkId) {
  void CHUNK_IMPORTS[id]()
}

export function prefetchAppRoutesForRole(role: string) {
  if (prefetchStarted || typeof window === "undefined") return
  prefetchStarted = true

  const chunks = canAccessAllSidebarTabs(role)
    ? PRIVILEGED_WARMUP
    : isClientRole(role)
      ? CLIENT_WARMUP
      : STANDARD_WARMUP

  const run = () => {
    for (const id of chunks) prefetchChunk(id)
  }

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 4000 })
  } else {
    setTimeout(run, 1500)
  }
}

export function prefetchChunkForPage(pageId: string) {
  if (typeof window === "undefined") return
  prefetchChunk(resolveChunkId(pageId))
}
