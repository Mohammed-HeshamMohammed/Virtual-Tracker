export type NavigateHandler = (pageId: string) => void

export type PageChunkProps = {
  pageId: string
  onNavigate: NavigateHandler
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
  | "download-agent"
