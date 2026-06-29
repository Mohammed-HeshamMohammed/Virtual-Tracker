"use client"

import { memo, Suspense } from "react"
import { PeopleSectionContent } from "@/features/members/pages/people-section-content"
import { getPageLabel } from "@/shared/ui/layout/config/nav-sections"
import { isComingSoonPage } from "@/shared/constants/coming-soon-pages"
import { CHUNK_COMPONENTS } from "@/app/routes/chunk-loaders"
import { ChunkRouteFallback } from "@/app/routes/chunk-fallbacks"
import { RoutePlaceholder } from "@/app/routes/placeholder"
import { resolveChunkId } from "@/app/routes/resolve-chunk"
import { PageTransitionShell } from "@/app/routes/page-transition-shell"
import { resolvePageTransitionKey } from "@/app/routes/people-member-pages"
import type { NavigateHandler } from "@/app/routes/types"

type PageContentProps = {
  activeItem: string
  onNavigate: NavigateHandler
}

function renderPageBody(activeItem: string, onNavigate: NavigateHandler) {
  if (isComingSoonPage(activeItem)) {
    return <RoutePlaceholder title={getPageLabel(activeItem)} />
  }

  if (
    activeItem === "people-members" ||
    activeItem === "people-members-tree" ||
    activeItem === "people-member-bans" ||
    activeItem === "people-teams"
  ) {
    return <PeopleSectionContent activeItem={activeItem} onNavigate={onNavigate} />
  }

  const Chunk = CHUNK_COMPONENTS[resolveChunkId(activeItem)]

  return (
    <Suspense fallback={<ChunkRouteFallback pageId={activeItem} />}>
      <Chunk pageId={activeItem} onNavigate={onNavigate} />
    </Suspense>
  )
}

function PageContentInner({ activeItem, onNavigate }: PageContentProps) {
  return (
    <PageTransitionShell activeItem={activeItem} transitionKey={resolvePageTransitionKey(activeItem)}>
      {renderPageBody(activeItem, onNavigate)}
    </PageTransitionShell>
  )
}

export const PageContent = memo(PageContentInner)
