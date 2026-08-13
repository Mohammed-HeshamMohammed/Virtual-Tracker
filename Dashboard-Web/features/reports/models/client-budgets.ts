export interface ClientBudgetRow {
  clientId: string
  clientName: string
  initial: string
  avatarClassName: string
  hasBudget: boolean
  budgetType: string | null
  cap: number
  spentAmount: number
  pctUsed: number
}
