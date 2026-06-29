export type ProjectBudgetSection = {
  label: string
  rows: ProjectBudgetRow[]
}

export type ProjectBudgetRow = {
  projectName: string
  initial: string
  avatarClassName: string
  spentSeconds: number
  budgetSeconds: number
}
