/** Same four buckets the Activity tab and focused time use. */
export type UsageCategory = "productive" | "neutral" | "distracting" | "unclassified"

export interface AppUsageRow {
  memberId: string
  memberName: string
  appName: string
  category: UsageCategory
  durationHms: string
  totalSeconds: number
}

export interface UrlUsageRow {
  memberId: string
  memberName: string
  domain: string
  category: UsageCategory
  /** How the agent worked out which site this was - "address bar" when it read
   *  the URL directly, a window-title variant when it had to infer. Shown so a
   *  row nobody recognises can be traced rather than doubted. */
  identifiedBy: string
  durationHms: string
  totalSeconds: number
}

export interface AppsUrlsReportData {
  apps: AppUsageRow[]
  urls: UrlUsageRow[]
  /** The range exceeded what the server will summarise; totals are short. */
  truncated: boolean
}
