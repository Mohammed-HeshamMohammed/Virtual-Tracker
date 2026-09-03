export type AuditLogActionKind = "updated" | "created" | "deleted" | "archived"

export interface AuditLogRow {
  id: string
  date: string
  author: string
  timeLabel: string
  action: string
  actionKind: AuditLogActionKind
  object: string
  member: string
  detail: string
}

export type AuditLogColumnKey =
  | "dateLogs"
  | "author"
  | "time"
  | "action"
  | "object"
  | "member"
  | "detail"
