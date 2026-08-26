import { apiFetch } from "@/infrastructure/api/http"
import { apiPath } from "@/infrastructure/api/path"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

export const EXPENSE_CATEGORIES = [
  { value: "travel", label: "Travel" },
  { value: "meals", label: "Meals" },
  { value: "software", label: "Software" },
  { value: "hardware", label: "Hardware" },
  { value: "office", label: "Office" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other" },
] as const

export type ExpenseStatus = "pending" | "approved" | "rejected"

export interface Expense {
  id: string
  memberId: string
  memberName: string
  projectId: string | null
  projectName: string
  clientName: string
  date: string
  category: string
  description: string
  notes: string
  amount: number
  currency: string
  billable: boolean
  status: ExpenseStatus
  reviewedBy: string | null
  reviewedAt: string | null
}

function toExpense(row: Record<string, unknown>): Expense {
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const rawDate = row.date
  return {
    id: String(row.id ?? ""),
    memberId: String(row.member_id ?? ""),
    memberName: str(row.member_name) || "Unknown",
    projectId: row.project_id ? String(row.project_id) : null,
    projectName: str(row.project_name),
    clientName: str(row.client_name),
    date: typeof rawDate === "string" ? rawDate.slice(0, 10) : new Date(String(rawDate)).toISOString().slice(0, 10),
    category: str(row.category) || "other",
    description: str(row.description),
    notes: str(row.notes),
    amount: Number(row.amount) || 0,
    currency: str(row.currency) || "USD",
    billable: row.billable === true,
    status: (str(row.status) || "pending") as ExpenseStatus,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  }
}

export interface CreateExpenseInput {
  memberId?: string
  projectId?: string | null
  date: string
  category: string
  description: string
  notes?: string
  amount: number
  currency?: string
  billable?: boolean
}

export async function listExpenses(filters: {
  from?: string
  to?: string
  status?: ExpenseStatus
  memberId?: string
} = {}): Promise<Expense[]> {
  const params = new URLSearchParams()
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.status) params.set("status", filters.status)
  if (filters.memberId) params.set("memberId", filters.memberId)
  const qs = params.toString()
  const res = await apiFetch(apiPath(`/api/expenses${qs ? `?${qs}` : ""}`))
  const json = (await res.json().catch(() => null)) as Envelope<Record<string, unknown>[]> | null
  if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to load expenses")
  return (json.data ?? []).map(toExpense)
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const res = await apiFetch(apiPath("/api/expenses"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = (await res.json().catch(() => null)) as Envelope<Record<string, unknown>> | null
  if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to save expense")
  return toExpense(json.data ?? {})
}

/** Management only; the backend also refuses self-review. */
export async function reviewExpense(id: string, status: "approved" | "rejected"): Promise<Expense> {
  const res = await apiFetch(apiPath(`/api/expenses/${id}/review`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  })
  const json = (await res.json().catch(() => null)) as Envelope<Record<string, unknown>> | null
  if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to review expense")
  return toExpense(json.data ?? {})
}

export async function deleteExpense(id: string): Promise<void> {
  const res = await apiFetch(apiPath(`/api/expenses/${id}`), { method: "DELETE" })
  const json = (await res.json().catch(() => null)) as Envelope<unknown> | null
  if (!res.ok || !json?.success) throw new Error(json?.error || "Failed to remove expense")
}
