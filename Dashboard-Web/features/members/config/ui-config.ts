
export const PEOPLE_TABLE_ROWS_PER_PAGE = 5
export const TABLE_MIN_VISIBLE_ROWS = 4
export const MEMBERS_TABLE_ROWS_PER_PAGE = PEOPLE_TABLE_ROWS_PER_PAGE
export const TEAMS_TABLE_ROWS_PER_PAGE = PEOPLE_TABLE_ROWS_PER_PAGE
export const TEAMS_TABLE_MIN_ROWS = TABLE_MIN_VISIBLE_ROWS
export const TEAMS_TABLE_MAX_ROWS = 6

export const PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT = [
  { minWidth: 1536, maxRows: 12 },
  { minWidth: 1440, maxRows: 8 },
  { minWidth: 0, maxRows: PEOPLE_TABLE_ROWS_PER_PAGE },
] as const

const MEMBERS_BANNER_DISMISSED_KEY = "vt-members-banner-dismissed-v1"


export const TEAM_STEPS = [
  { n: 1, label: "CREATE TEAM" },
  { n: 2, label: "ADD MEMBERS" },
  { n: 3, label: "ADD PROJECTS" },
] as const

const TEAM_BANNER_DISMISSED_KEY = "vt-teams-banner-dismissed-v1"
