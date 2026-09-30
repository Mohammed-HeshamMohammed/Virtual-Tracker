import type { ProjectType } from "@/features/projects/api/project-api"
import type { ProjectRules } from "@/features/projects/utils/project-rules"

export type ProjectListItem = {
  id: string
  name: string
  type: ProjectType
  color: string
  status: "active" | "archived"
  teams: string[]
  members: number
  memberLimit: number | null
  todos: { done: number; total: number } | null
  budget: { spent: number; total: number | null; type: "hours" | "cost" } | null
  memberIds: string[]
  /** The Management tab's switches; absent on a row seeded before the real list loads. */
  rules?: ProjectRules
}
