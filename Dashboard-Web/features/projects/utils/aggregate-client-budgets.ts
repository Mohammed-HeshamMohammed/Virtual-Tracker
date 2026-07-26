import type { ClientBudget } from "@/features/clients/api/client-api"

export type ClientBudgetSnapshot = ClientBudget | null | undefined

export type AggregatedProjectBudgetFields = {
  hasBudget: boolean
  budgetType: string
  budgetBasedOn: string
  budgetTotal: string
  budgetResets: string
  budgetNotifyAt: string
  fromClientCount: number
}

function mapClientBudgetTypeToProject(type: ClientBudget["type"]): string {
  if (type === "hourly") return "Hours based"
  return "Cost based"
}

function mapClientResetsToProject(resets: string): string {
  const value = resets.trim().toLowerCase()
  if (value === "monthly") return "Monthly"
  if (value === "quarterly") return "Quarterly"
  if (value === "yearly") return "Yearly"
  return "Never"
}

/** One client's budget contribution when linked to a single project. */
export function clientBudgetContributionForProject(
  budget: ClientBudgetSnapshot,
  options?: { memberCount?: number },
): number {
  if (!budget || budget.type === "none" || budget.cost <= 0) return 0
  const memberCount = Math.max(1, options?.memberCount ?? 1)
  if (budget.basedOn === "per_person") return budget.cost * memberCount
  return budget.cost
}

/** Sum selected client budgets into project Budget & Limits fields. */
export function aggregateClientBudgetsForProject(
  clients: { id: string; budget?: ClientBudgetSnapshot }[],
  selectedClientIds: string[],
  options?: { memberCount?: number },
): AggregatedProjectBudgetFields | null {
  const selected = new Set(selectedClientIds)
  const withBudget = clients.filter(
    (client) => selected.has(client.id) && client.budget && client.budget.type !== "none",
  )
  if (withBudget.length === 0) return null

  let totalCost = 0
  let primary = withBudget[0]!.budget!

  for (const client of withBudget) {
    const budget = client.budget!
    totalCost += clientBudgetContributionForProject(budget, options)
    if (primary.type === "none") primary = budget
  }

  if (totalCost <= 0) return null

  return {
    hasBudget: true,
    budgetType: mapClientBudgetTypeToProject(primary.type),
    budgetBasedOn: "Bill rate",
    budgetTotal: String(Math.round(totalCost * 100) / 100),
    budgetResets: mapClientResetsToProject(primary.resets),
    budgetNotifyAt: "",
    fromClientCount: withBudget.length,
  }
}
