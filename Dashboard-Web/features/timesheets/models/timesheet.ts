
export interface TimeEntry {
  id: string
  member: string
  avatar: string
  project: string
  task: string
  date: string
  startTime: string
  endTime: string
  duration: string
  status: "approved" | "pending" | "rejected"
}

export interface AddEntryFormState {
  memberId: string
  projectId: string
  task: string
  date: string
  startTime: string
  endTime: string
  status: TimeEntry["status"]
}

export type Tab = "timesheets" | "manual-time"
export type PayPeriod = "weekly" | "none" | "twice-per-month" | "bi-weekly" | "monthly"

export interface Member {
  id: string
  name: string
  email: string
  avatar: string
  color: string
}

export interface TimesheetDay {
  day: string
  hours: string
}

export interface SetupData {
  members: string[]
  payPeriod: PayPeriod
  autoSetup: boolean
}
