export const PEOPLE_MEMBER_SUBPAGE_IDS = [
  "people-members",
  "people-members-tree",
  "people-member-bans",
] as const

export type PeopleMemberSubpageId = (typeof PEOPLE_MEMBER_SUBPAGE_IDS)[number]

export const PEOPLE_MEMBER_SUBPAGE_ORDER = [
  "people-members",
  "people-members-tree",
  "people-member-bans",
] as const

export function isPeopleMemberSubpage(pageId: string): pageId is PeopleMemberSubpageId {
  return (PEOPLE_MEMBER_SUBPAGE_IDS as readonly string[]).includes(pageId)
}

/** Stable shell key so Members ↔ Tree ↔ Bans animate inside PeopleSectionContent, not the whole app shell. */
export function resolvePageTransitionKey(pageId: string): string {
  if (isPeopleMemberSubpage(pageId)) return "people-member-section"
  return pageId
}

export function getPeopleMemberSubpageDirection(previousPageId: string, nextPageId: string): number {
  if (previousPageId === nextPageId) return 0
  const previousIndex = PEOPLE_MEMBER_SUBPAGE_ORDER.indexOf(previousPageId as PeopleMemberSubpageId)
  const nextIndex = PEOPLE_MEMBER_SUBPAGE_ORDER.indexOf(nextPageId as PeopleMemberSubpageId)
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return 0
  return nextIndex > previousIndex ? 1 : -1
}
