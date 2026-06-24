export type ProjectListItem = {
  id: string
  name: string
  color: string
  status: "active" | "archived"
  teams: string[]
  members: number
  memberLimit: number | null
  todos: { done: number; total: number }
  budget: { spent: number; total: number | null; currency: string } | null
  memberIds: string[]
}
