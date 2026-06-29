"use client"

import { useEffect, useRef, type MutableRefObject } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { usePermissions } from "@/features/auth/hooks/use-permissions"
import { MembersPage } from "@/features/members/pages/members-page"
import { MemberTreePage } from "@/features/members/pages/member-tree-page"
import { MemberBansPage } from "@/features/members/pages/member-bans-page"
import { TeamsPage } from "@/features/teams"
import { PeopleTeamScopeProvider } from "@/features/members/context/people-team-scope-context"
import {
  getPeopleMemberSubpageDirection,
  isPeopleMemberSubpage,
  type PeopleMemberSubpageId,
} from "@/app/routes/people-member-pages"
import type { NavigateHandler } from "@/app/routes/types"

type PeopleSectionPageId = PeopleMemberSubpageId | "people-teams"

type PeopleSectionContentProps = {
  activeItem: PeopleSectionPageId
  onNavigate: NavigateHandler
}

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]
const SLIDE_PX = 24

function renderMemberSubpage(activeItem: PeopleMemberSubpageId, onNavigate: NavigateHandler) {
  switch (activeItem) {
    case "people-members-tree":
      return <MemberTreePage />
    case "people-member-bans":
      return <MemberBansPage />
    default:
      return <MembersPage onNavigate={onNavigate} />
  }
}

export function PeopleSectionContent({ activeItem, onNavigate }: PeopleSectionContentProps) {
  const { canManageMemberBans } = usePermissions()
  const reduceMotion = useReducedMotion()
  const previousPageRef = useRef(activeItem)

  useEffect(() => {
    if (activeItem === "people-member-bans" && !canManageMemberBans) {
      onNavigate("people-members")
    }
  }, [activeItem, canManageMemberBans, onNavigate])

  return (
    <PeopleTeamScopeProvider>
      <PeopleSectionContentInner
        activeItem={activeItem}
        onNavigate={onNavigate}
        canManageMemberBans={canManageMemberBans}
        reduceMotion={reduceMotion}
        previousPageRef={previousPageRef}
      />
    </PeopleTeamScopeProvider>
  )
}

function PeopleSectionContentInner({
  activeItem,
  onNavigate,
  canManageMemberBans,
  reduceMotion,
  previousPageRef,
}: PeopleSectionContentProps & {
  canManageMemberBans: boolean
  reduceMotion: boolean | null
  previousPageRef: MutableRefObject<PeopleSectionPageId>
}) {
  if (activeItem === "people-member-bans" && !canManageMemberBans) {
    return <MembersPage onNavigate={onNavigate} />
  }

  if (activeItem === "people-teams") {
    return <TeamsPage />
  }

  if (!isPeopleMemberSubpage(activeItem)) {
    return <MembersPage onNavigate={onNavigate} />
  }

  let direction = 0
  if (activeItem !== previousPageRef.current) {
    direction = getPeopleMemberSubpageDirection(previousPageRef.current, activeItem)
    previousPageRef.current = activeItem
  }

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={activeItem}
          custom={direction}
          className="absolute inset-0 flex min-h-0 flex-col"
          initial={
            (reduceMotion
              ? false
              : (dir: number) =>
                  dir === 0
                    ? { opacity: 0 }
                    : { opacity: 0, x: dir > 0 ? SLIDE_PX : -SLIDE_PX }) as any
          }
          animate={{ opacity: 1, x: 0 }}
          exit={
            (reduceMotion
              ? undefined
              : (dir: number) =>
                  dir === 0
                    ? { opacity: 0 }
                    : { opacity: 0, x: dir > 0 ? -SLIDE_PX : SLIDE_PX }) as any
          }
          transition={transition}
        >
          {renderMemberSubpage(activeItem, onNavigate)}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
