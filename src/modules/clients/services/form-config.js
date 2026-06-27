/** Add-client form layout served to the Desktop client (matches frontend tabs). */
export const CLIENT_FORM_TABS = [
  { key: "general", label: "GENERAL" },
  { key: "contact", label: "CONTACT INFO" },
  { key: "projects", label: "PROJECTS" },
  { key: "budget", label: "BUDGET" },
  { key: "invoicing", label: "INVOICING" },
];

export const BUDGET_TYPE_OPTIONS = [
  { value: "hourly", label: "Hourly rate" },
  { value: "fixed", label: "Fixed price" },
  { value: "retainer", label: "Retainer" },
  { value: "none", label: "No budget" },
];

export const BUDGET_BASE_OPTIONS = [
  { value: "per_person", label: "Per person" },
  { value: "per_project", label: "Per project" },
  { value: "total", label: "Total" },
];

export const BUDGET_RESET_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "never", label: "Never" },
];

export const INVOICE_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
];

export const INVOICE_AMOUNT_BASIS_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "fixed", label: "Fixed price" },
];

export const LINE_ITEM_OPTIONS = [
  { value: "detailed_project_user_date", label: "By user, project, and date" },
  { value: "detailed_project_date", label: "By project and date" },
  { value: "detailed_project_user", label: "By user and project" },
  { value: "detailed_todo_user_date", label: "By user, to-do, and date" },
  { value: "detailed_todo_date", label: "By to-do and date" },
  { value: "detailed_todo_user", label: "By user and to-do" },
  { value: "summary_user_date", label: "By user and date" },
  { value: "summary_user", label: "By user" },
  { value: "summary_project", label: "By project" },
  { value: "summary_todo", label: "By to-do" },
  { value: "summary_date", label: "By date" },
];

export const CLIENT_FORM_FIELDS = [
  { key: "clientMember", label: "Client member", type: "select", tab: "general", optionsSource: "clientMembers" },
  { key: "name", label: "Name", type: "preview", tab: "general" },
  { key: "address", label: "Address", type: "text", tab: "general" },
  { key: "city", label: "City", type: "text", tab: "general" },
  { key: "state", label: "State", type: "text", tab: "general" },
  { key: "zip", label: "ZIP", type: "text", tab: "general" },
  { key: "country", label: "Country", type: "text", tab: "general" },
  { key: "phone", label: "Phone", type: "tel", tab: "contact" },
  { key: "email", label: "Email", type: "preview", tab: "contact" },
  { key: "projects", label: "Projects", type: "multiselect", tab: "projects", optionsSource: "projects" },
  { key: "budget.type", label: "Budget type", type: "select", tab: "budget", optionsKey: "budgetTypes" },
  { key: "budget.basedOn", label: "Based on", type: "select", tab: "budget", optionsKey: "budgetBases" },
  { key: "budget.cost", label: "Cost", type: "number", tab: "budget" },
  { key: "budget.notifyAt", label: "Notify at %", type: "number", tab: "budget" },
  { key: "budget.resets", label: "Resets", type: "select", tab: "budget", optionsKey: "budgetResets" },
  { key: "invoicing.custom", label: "Custom for client", type: "toggle", tab: "invoicing" },
  { key: "invoicing.notes", label: "Notes", type: "textarea", tab: "invoicing" },
  { key: "invoicing.netTerms", label: "Net terms (days)", type: "number", tab: "invoicing" },
  { key: "invoicing.taxRate", label: "Tax rate %", type: "number", tab: "invoicing" },
  { key: "invoicing.autoInvoicing", label: "Auto invoicing", type: "toggle", tab: "invoicing" },
  { key: "invoicing.autoAmountBasis", label: "Amount based on", type: "segment", tab: "invoicing", optionsKey: "amountBasis" },
  { key: "invoicing.autoFixedAmount", label: "Fixed amount", type: "number", tab: "invoicing" },
  { key: "invoicing.autoFrequency", label: "Frequency", type: "select", tab: "invoicing", optionsKey: "frequencies" },
  { key: "invoicing.autoDelaySending", label: "Delay sending (days)", type: "number", tab: "invoicing" },
  { key: "invoicing.autoReminderDays", label: "Reminder after due (days)", type: "number", tab: "invoicing" },
  { key: "invoicing.autoLineItems", label: "Line items", type: "select", tab: "invoicing", optionsKey: "lineItems" },
  { key: "invoicing.autoIncludeNonBillable", label: "Include non-billable", type: "toggle", tab: "invoicing" },
  { key: "invoicing.autoIncludeExpenses", label: "Include expenses", type: "toggle", tab: "invoicing" },
];
