export type ProjectListItem = {
  id: string
  name: string
  color: string
  status: "active" | "archived"
  teams: string[]
  members: number
  memberLimit: number | null
  todos: { done: number; total: number }
  // type replaces the old hardcoded "currency: $" - an Hours-based project's
  // total/spent are hours, not dollars, and rendering always assumed dollars.
  budget: { spent: number; total: number | null; type: "hours" | "cost" } | null
  memberIds: string[]
}
