// ============================================================================
// People / Members — shared UI configuration constants
// ============================================================================

/** Default rows shown per table page across People (members, invites, teams). */
export const PEOPLE_TABLE_ROWS_PER_PAGE = 5
/** Fallback row count when the viewport cannot be measured yet. */
export const TABLE_MIN_VISIBLE_ROWS = 4
export const MEMBERS_TABLE_ROWS_PER_PAGE = PEOPLE_TABLE_ROWS_PER_PAGE
export const TEAMS_TABLE_ROWS_PER_PAGE = PEOPLE_TABLE_ROWS_PER_PAGE
/** Teams table fills available height with at least this many rows. */
export const TEAMS_TABLE_MIN_ROWS = TABLE_MIN_VISIBLE_ROWS
/** Teams table never shows more than this many rows per page. */
export const TEAMS_TABLE_MAX_ROWS = 6

/** Responsive upper cap — more rows only when the viewport is tall/wide enough. */
export const PEOPLE_TABLE_ROW_CAP_BY_BREAKPOINT = [
  { minWidth: 1536, maxRows: 12 },
  { minWidth: 1440, maxRows: 8 },
  { minWidth: 0, maxRows: PEOPLE_TABLE_ROWS_PER_PAGE },
] as const

const MEMBERS_BANNER_DISMISSED_KEY = "vt-members-banner-dismissed-v1"

// ============================================================================
// People / Teams — UI configuration constants
// ============================================================================

/** Stepper configuration for add team modal */
export const TEAM_STEPS = [
  { n: 1, label: "CREATE TEAM" },
  { n: 2, label: "ADD MEMBERS" },
  { n: 3, label: "ADD PROJECTS" },
] as const

/** LocalStorage key for banner dismissed state */
const TEAM_BANNER_DISMISSED_KEY = "vt-teams-banner-dismissed-v1"
