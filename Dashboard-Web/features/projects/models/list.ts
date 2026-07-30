import type { ProjectType } from "@/features/projects/api/project-api"

export type ProjectListItem = {
  id: string
  name: string
  type: ProjectType
  color: string
  status: "active" | "archived"
  teams: string[]
  members: number
  memberLimit: number | null
  /** null for "calling" projects, which have no tasks by design. */
  todos: { done: number; total: number } | null
  // type replaces the old hardcoded "currency: $" - an Hours-based project's
  // total/spent are hours, not dollars, and rendering always assumed dollars.
  budget: { spent: number; total: number | null; type: "hours" | "cost" } | null
  memberIds: string[]
}
