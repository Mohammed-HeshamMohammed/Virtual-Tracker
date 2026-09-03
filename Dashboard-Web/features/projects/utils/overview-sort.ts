export type OverviewProjectHealth = "on_track" | "at_risk" | "stalled" | "no_tasks"

export type OverviewSortableProject = {
  id: string
  status: "active" | "archived"
  health: OverviewProjectHealth
  todos: { done: number; total: number }
  budget: { spent: number; total: number | null; type: "hours" | "cost" } | null
}

function healthRank(health: OverviewProjectHealth): number {
  if (health === "on_track") return 4
  if (health === "at_risk") return 3
  if (health === "no_tasks") return 2
  return 1
}

export function sortProjectsForOverview<T extends OverviewSortableProject>(projects: T[]): T[] {
  return projects.toSorted((a, b) => {
    const healthDiff = healthRank(b.health) - healthRank(a.health)
    if (healthDiff !== 0) return healthDiff

    const aProgress = a.todos.total > 0 ? a.todos.done / a.todos.total : 0
    const bProgress = b.todos.total > 0 ? b.todos.done / b.todos.total : 0
    if (bProgress !== aProgress) return bProgress - aProgress

    const aHasBudget = a.budget?.total != null && a.budget.total > 0
    const bHasBudget = b.budget?.total != null && b.budget.total > 0
    if (aHasBudget !== bHasBudget) return aHasBudget ? -1 : 1

    const aTotal = a.budget?.total ?? 0
    const bTotal = b.budget?.total ?? 0
    const aSpent = a.budget?.spent ?? 0
    const bSpent = b.budget?.spent ?? 0
    const aRemainingRatio = aTotal > 0 ? (aTotal - aSpent) / aTotal : 0
    const bRemainingRatio = bTotal > 0 ? (bTotal - bSpent) / bTotal : 0
    if (bRemainingRatio !== aRemainingRatio) return bRemainingRatio - aRemainingRatio
    return bTotal - aTotal
  })
}
