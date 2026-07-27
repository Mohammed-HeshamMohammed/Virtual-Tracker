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

export const ACTIVITY_SUBPAGE_IDS = [
  "activity-screenshots",
  "activity-apps",
  "activity-urls",
] as const

export type ActivitySubpageId = (typeof ACTIVITY_SUBPAGE_IDS)[number]

export function isActivitySubpage(pageId: string): pageId is ActivitySubpageId {
  return (ACTIVITY_SUBPAGE_IDS as readonly string[]).includes(pageId)
}

/** Stable shell key so Members ↔ Tree ↔ Bans (and Activity's Screenshots ↔ Apps ↔ URLs) animate inside their own section content, not the whole app shell. */
export function resolvePageTransitionKey(pageId: string): string {
  if (isPeopleMemberSubpage(pageId)) return "people-member-section"
  if (isActivitySubpage(pageId)) return "activity-section"
  return pageId
}

export function getPeopleMemberSubpageDirection(previousPageId: string, nextPageId: string): number {
  if (previousPageId === nextPageId) return 0
  const previousIndex = PEOPLE_MEMBER_SUBPAGE_ORDER.indexOf(previousPageId as PeopleMemberSubpageId)
  const nextIndex = PEOPLE_MEMBER_SUBPAGE_ORDER.indexOf(nextPageId as PeopleMemberSubpageId)
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return 0
  return nextIndex > previousIndex ? 1 : -1
}
