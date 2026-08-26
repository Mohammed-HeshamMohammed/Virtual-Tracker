import { PayPeriod } from "@/features/timesheets/models/timesheet"

export const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected"] as const
export const TIME_PERIODS = ["Today", "This week", "This month", "This quarter", "This year"] as const

export const PAY_PERIOD_OPTIONS: { value: PayPeriod; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "none", label: "None" },
  { value: "twice-per-month", label: "Twice per month" },
  { value: "bi-weekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
]

export const EMPTY_APPROVAL_MEMBERS: {
  id: string
  name: string
  email: string
  avatar: string
  color: string
}[] = []
