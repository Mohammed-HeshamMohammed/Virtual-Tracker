/**
 * `params` carries which item to open, not just which page - a notification
 * about one task has to be able to open THAT task. Optional so every existing
 * caller keeps working unchanged.
 */
export type NavigateParams = Record<string, string>

export type NavigateHandler = (pageId: string, params?: NavigateParams) => void

export type PageChunkProps = {
  pageId: string
  onNavigate: NavigateHandler
  /** Set when navigation named a specific item; pages that don't care ignore it. */
  pageParams?: NavigateParams
}

export type AppChunkId =
  | "dashboard"
  | "people"
  | "projects"
  | "activity"
  | "timesheets"
  | "reports"
  | "financials"
  | "settings"
  | "profile"
