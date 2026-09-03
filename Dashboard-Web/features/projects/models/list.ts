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
  todos: { done: number; total: number } | null
  budget: { spent: number; total: number | null; type: "hours" | "cost" } | null
  memberIds: string[]
}
