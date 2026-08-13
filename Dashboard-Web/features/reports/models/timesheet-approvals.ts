export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected"

export interface TimesheetApprovalRow {
  id: string
  memberId: string
  memberName: string
  initials: string
  periodStart: string
  periodEnd: string
  status: TimesheetStatus
  totalHours: number
  billableHours: number
  submittedAt: string | null
  approvedAt: string | null
  approvedByName: string | null
}
