export type ProjectBudgetSection = {
  label: string
  rows: ProjectBudgetRow[]
}

export type ProjectBudgetRow = {
  projectName: string
  initial: string
  avatarClassName: string
  budgetType: "hours" | "cost" | null
  spentSeconds: number
  budgetSeconds: number
  spentAmount: number
  budgetAmount: number
}
