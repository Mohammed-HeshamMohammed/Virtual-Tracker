export const FULL_BLEED_PAGE_IDS = new Set([
  "people-members",
  "people-teams",
  "people-members-tree",
  "people-member-bans",
  "pm-overview",
  "pm-projects",
  "pm-tasks",
  "pm-clients",
  "activity-apps",
  "activity-urls",
  "activity-screenshots",
])

export function isFullBleedPage(pageId: string): boolean {
  return FULL_BLEED_PAGE_IDS.has(pageId)
}
