export type ProjectBudgetSection = {
  label: string
  rows: ProjectBudgetRow[]
}

export type ProjectBudgetRow = {
  projectName: string
  initial: string
  avatarClassName: string
  /** null = no budget configured for this project at all. */
  budgetType: "hours" | "cost" | null
  /** Real tracked seconds, always populated regardless of budget type - a
   *  cost-based project still tracked real time, it's just not what its cap
   *  is measured in. */
  spentSeconds: number
  /** Only meaningful when budgetType === "hours" - the cap itself, in
   *  seconds. 0 for a cost-based or unbudgeted project. */
  budgetSeconds: number
  /** Only meaningful when budgetType === "cost" - dollars spent and the cap
   *  itself. 0 for an hours-based or unbudgeted project. */
  spentAmount: number
  budgetAmount: number
}
