import {
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  type Priority,
  type TaskStatus,
} from "@/features/tasks/constants/task-constants"

export const ALL_FILTER = "" as const

export function buildProjectFilterOptions(projects: { id: string; name: string }[]) {
  return [
    { value: ALL_FILTER, label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ]
}

export function buildMemberFilterOptions(members: { id: string; name: string }[]) {
  return [
    { value: ALL_FILTER, label: "All employees" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ]
}

export const PRIORITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_FILTER, label: "All priorities" },
  ...(Object.keys(PRIORITY_CONFIG) as Priority[]).map((priority) => ({
    value: priority,
    label: PRIORITY_CONFIG[priority].label,
  })),
]

export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_FILTER, label: "All statuses" },
  ...(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((status) => ({
    value: status,
    label: STATUS_CONFIG[status].label,
  })),
]

export const TIME_ENTRY_STATUS_OPTIONS = [
  { value: "pending" as const, label: "Pending" },
  { value: "approved" as const, label: "Approved" },
  { value: "rejected" as const, label: "Rejected" },
]
