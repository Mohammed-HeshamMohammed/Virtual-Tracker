export type AppSearchEntryKind = "page" | "action" | "tab" | "section"

export type AppSearchEntry = {
  id: string
  pageId: string
  title: string
  section: string
  subsection?: string
  pageLabel?: string
  description?: string
  keywords: string[]
  kind?: AppSearchEntryKind
}
