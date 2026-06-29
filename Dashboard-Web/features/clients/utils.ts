import type { Client as ApiClient } from "@/features/clients/api/client-api"
import type { Client, ClientFormData } from "@/features/clients/models/client"

/** Map API client (optional address fields) to modal form defaults. */
export function clientFormFromApi(data: ApiClient): ClientFormData {
  const base = emptyClient()
  return {
    ...base,
    ...data,
    city: data.city ?? "",
    state: data.state ?? "",
    zip: data.zip ?? "",
    country: data.country ?? "",
    budget: data.budget ?? base.budget,
    budgetId: data.budgetId,
    invoicingId: data.invoicingId,
  }
}

export function emptyClient(): ClientFormData {
  return {
    name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    phone: "",
    email: "",
    clientMember: "",
    projects: [],
    budget: {
      type: "hourly",
      basedOn: "per_project",
      cost: 0,
      notifyAt: 80,
      resets: "monthly",
    },
    invoicing: {
      custom: false,
      notes: "",
      netTerms: 30,
      taxRate: 0,
      autoInvoicing: false,
      autoAmountBasis: "hourly",
      autoFixedAmount: 0,
      autoFrequency: "monthly",
      autoDelaySending: 0,
      autoReminderDays: 7,
      autoLineItems: "detailed_project_user_date",
      autoIncludeNonBillable: false,
      autoIncludeExpenses: false,
    },
  }
}

export async function exportClientsToExcel(
  clients: Client[],
  tab: string,
  search: string,
): Promise<void> {
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet("Clients")

  worksheet.columns = [
    { header: "Name", key: "name", width: 20 },
    { header: "Status", key: "status", width: 15 },
    { header: "Budget Type", key: "budgetType", width: 15 },
    { header: "Budget Cost", key: "budgetCost", width: 15 },
    { header: "Budget Resets", key: "budgetResets", width: 15 },
    { header: "Auto-invoicing", key: "autoInvoicing", width: 20 },
    { header: "Auto Amount Basis", key: "autoAmountBasis", width: 20 },
    { header: "Projects Count", key: "projectsCount", width: 15 },
    { header: "Projects", key: "projects", width: 30 },
  ]

  const rows = clients.map((client) => {
    const budgetType = client.budget
      ? client.budget.type === "fixed"
        ? "Fixed fee"
        : "Hourly"
      : "—"
    const budgetCost = client.budget
      ? client.budget.type === "fixed"
        ? `$${client.budget.cost.toLocaleString()}`
        : `$${client.budget.cost}/h`
      : "—"
    const budgetResets = client.budget ? client.budget.resets : "—"
    const projectsLabel =
      client.projects.length > 0 ? client.projects.join(", ") : "No projects assigned"
    const autoInvoicingLabel = client.invoicing.autoInvoicing
      ? `On (${client.invoicing.autoFrequency})`
      : "Off"

    return {
      name: client.name,
      status: client.status,
      budgetType,
      budgetCost,
      budgetResets,
      autoInvoicing: autoInvoicingLabel,
      autoAmountBasis: client.invoicing.autoAmountBasis,
      projectsCount: client.projects.length,
      projects: projectsLabel,
    }
  })

  rows.forEach((row) => worksheet.addRow(row))
  worksheet.addRow({})
  worksheet.addRow(["Tab", tab])
  worksheet.addRow(["Search", search || "—"])
  worksheet.addRow(["Exported At", new Date().toLocaleString()])

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `clients-${tab}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
