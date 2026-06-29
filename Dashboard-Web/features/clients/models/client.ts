export type ClientStatus = "active" | "archived"
export type BudgetType = "hourly" | "fixed" | "retainer" | "none"
export type BudgetBase = "per_person" | "per_project" | "total"
export type BudgetReset = "monthly" | "quarterly" | "yearly" | "never"

export interface Client {
  id: string
  status: ClientStatus
  name: string
  address: string
  phone: string
  email: string
  clientMember: string
  projects: string[]
  budget: {
    type: BudgetType
    basedOn: BudgetBase
    cost: number
    notifyAt: number
    resets: BudgetReset
  } | null
  invoicing: {
    custom: boolean
    notes: string
    netTerms: number
    taxRate: number
    autoInvoicing: boolean
    autoAmountBasis: "hourly" | "fixed"
    autoFixedAmount: number
    autoFrequency: "weekly" | "biweekly" | "monthly"
    autoDelaySending: number
    autoReminderDays: number
    autoLineItems: string
    autoIncludeNonBillable: boolean
    autoIncludeExpenses: boolean
  }
}

export type ClientFormData = Omit<Client, "id" | "status"> & {
  city: string
  state: string
  zip: string
  country: string
  budgetId?: string
  invoicingId?: string
}

export interface ClientEditLoadedState extends ClientFormData {}

const MODAL_TABS = ["General", "Contact info", "Projects", "Budget", "Invoicing"] as const
export type ModalTab = (typeof MODAL_TABS)[number]
